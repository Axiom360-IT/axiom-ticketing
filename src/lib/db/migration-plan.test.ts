import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DeployMigration } from "./migration-manifest";
import {
  decideRun,
  pendingMigrations,
  probeErrorMeansNotApplied,
} from "./migration-plan";
import { runMigrationScript } from "./run-migration-script";

const URL = "postgres://x";

describe("decideRun — whether to touch a database at all", () => {
  it("runs on a production Vercel build", () => {
    expect(decideRun({ VERCEL_ENV: "production", DATABASE_URL: URL }, { force: false })).toEqual({
      action: "run",
    });
  });

  it("SKIPS a preview build — an unmerged branch must not change production's schema", () => {
    const d = decideRun({ VERCEL_ENV: "preview", DATABASE_URL: URL }, { force: false });
    expect(d.action).toBe("skip");
  });

  it("SKIPS a development build", () => {
    expect(decideRun({ VERCEL_ENV: "development", DATABASE_URL: URL }, { force: false }).action).toBe("skip");
  });

  it("SKIPS GitHub CI and a laptop — VERCEL_ENV is simply not set there", () => {
    // The default is NO. This is what lets `pnpm build` in CI stay database-free.
    expect(decideRun({ DATABASE_URL: URL }, { force: false }).action).toBe("skip");
    expect(decideRun({}, { force: false }).action).toBe("skip");
  });

  it("skips quietly when there is no database and it was not a production build", () => {
    // A preview with no DATABASE_URL must not fail — it was never going to migrate.
    expect(decideRun({ VERCEL_ENV: "preview" }, { force: false }).action).toBe("skip");
  });

  it("FAILS a production build that cannot see DATABASE_URL", () => {
    // The one case that must not skip: it would ship new code against an
    // unmigrated schema. Better a failed build and the old version still live.
    const d = decideRun({ VERCEL_ENV: "production" }, { force: false });
    expect(d.action).toBe("fail");
    if (d.action === "fail") {
      expect(d.reason).toContain("DATABASE_URL");
      expect(d.reason).toContain("SKIP_DEPLOY_MIGRATIONS");
    }
  });

  it("lets SKIP_DEPLOY_MIGRATIONS=1 override even a production build", () => {
    const d = decideRun(
      { VERCEL_ENV: "production", DATABASE_URL: URL, SKIP_DEPLOY_MIGRATIONS: "1" },
      { force: false },
    );
    expect(d.action).toBe("skip");
  });

  it("lets the escape hatch rescue a build that would otherwise fail", () => {
    expect(decideRun({ VERCEL_ENV: "production", SKIP_DEPLOY_MIGRATIONS: "1" }, { force: false }).action).toBe("skip");
  });

  it("only honours the exact value 1", () => {
    // 'false', '0' and '' must NOT silently disable migrations.
    for (const v of ["0", "false", "", "no"]) {
      expect(
        decideRun({ VERCEL_ENV: "production", DATABASE_URL: URL, SKIP_DEPLOY_MIGRATIONS: v }, { force: false }).action,
        v,
      ).toBe("run");
    }
  });

  it("--force runs from anywhere that has a database", () => {
    expect(decideRun({ DATABASE_URL: URL }, { force: true }).action).toBe("run");
  });

  it("--force still fails without a database rather than doing nothing silently", () => {
    expect(decideRun({}, { force: true }).action).toBe("fail");
  });
});

describe("pendingMigrations", () => {
  const m = (id: string): DeployMigration => ({ id, description: id });
  const manifest = [m("a"), m("b"), m("c")];

  it("returns everything on a fresh ledger, in manifest order", () => {
    expect(pendingMigrations(manifest, new Set()).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("returns nothing once everything has run — a routine deploy changes nothing", () => {
    expect(pendingMigrations(manifest, new Set(["a", "b", "c"]))).toEqual([]);
  });

  it("returns only what is missing, still in order", () => {
    expect(pendingMigrations(manifest, new Set(["b"])).map((x) => x.id)).toEqual(["a", "c"]);
  });

  it("ignores a ledger entry the manifest no longer lists", () => {
    expect(pendingMigrations(manifest, new Set(["gone", "a", "b", "c"]))).toEqual([]);
  });
});

describe("probeErrorMeansNotApplied", () => {
  it("reads a missing column or table as 'not in place'", () => {
    expect(probeErrorMeansNotApplied("42703")).toBe(true);
    expect(probeErrorMeansNotApplied("42P01")).toBe(true);
  });

  it("does NOT swallow any other failure", () => {
    // A timeout or a permissions error is a real problem, not 'not applied'.
    for (const code of ["57014", "42501", "08006", undefined]) {
      expect(probeErrorMeansNotApplied(code as string | undefined), String(code)).toBe(false);
    }
  });
});

// The child-process helper, exercised on a throwaway script — never a real
// migration. Proves the two things the build relies on: `--import tsx` works
// under this Node, and a failing script becomes a failing result.
describe("runMigrationScript", () => {
  const dir = mkdtempSync(join(tmpdir(), "migrations-"));
  const script = (name: string, body: string) => {
    const f = join(dir, name);
    writeFileSync(f, body);
    return f;
  };

  it("reports success for a script that exits 0", () => {
    const f = script("ok.ts", 'const n: number = 1; console.log("ran", n);');
    expect(runMigrationScript(f)).toEqual({ ok: true });
  });

  it("reports failure for a script that exits non-zero", () => {
    const f = script("bad.ts", "process.exit(3);");
    const r = runMigrationScript(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("3");
  });

  it("reports failure for a script that throws", () => {
    const f = script("throws.ts", 'throw new Error("boom");');
    expect(runMigrationScript(f).ok).toBe(false);
  });

  it("kills a script that hangs, instead of hanging the build", () => {
    const f = script("hang.ts", "setInterval(() => {}, 1000);");
    const r = runMigrationScript(f, { timeoutMs: 1500 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("timed out");
  }, 15_000);

  it("reports failure for a script that does not exist", () => {
    expect(runMigrationScript(join(dir, "missing.ts")).ok).toBe(false);
  });
});
