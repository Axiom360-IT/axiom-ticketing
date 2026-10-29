import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEPLOY_MIGRATIONS,
  LEGACY_MIGRATIONS,
  MANUAL_MIGRATIONS,
} from "./migration-manifest";

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

/** Every `db:add-*` script, mapped to the file it runs. */
const addScripts = Object.entries(pkg.scripts)
  .filter(([name]) => name.startsWith("db:add-"))
  .map(([name, cmd]) => {
    const file = cmd.match(/src\/lib\/db\/([a-z0-9-]+)\.ts/)?.[1];
    return { name, id: file ?? "" };
  });

const AUTO = DEPLOY_MIGRATIONS.map((m) => m.id);
const MANUAL = MANUAL_MIGRATIONS.map((m) => m.id);
const ALL_LISTED = [...AUTO, ...MANUAL, ...LEGACY_MIGRATIONS];

describe("migration manifest", () => {
  it("finds the migration scripts at all (guards the parser itself)", () => {
    // If this drops to zero every check below passes vacuously.
    expect(addScripts.length).toBeGreaterThanOrEqual(30);
    expect(addScripts.every((s) => s.id !== "")).toBe(true);
  });

  it("places EVERY db:add-* script in exactly one list", () => {
    // THE guard. A migration written but not registered here would ship code
    // that reads a column nobody created. Fix: add it to DEPLOY_MIGRATIONS
    // (additive + idempotent) or MANUAL_MIGRATIONS (privileged / needs a human).
    const unplaced = addScripts.filter((s) => !ALL_LISTED.includes(s.id)).map((s) => s.name);
    expect(unplaced).toEqual([]);
  });

  it("lists nothing that has no script behind it", () => {
    const real = new Set(addScripts.map((s) => s.id));
    expect(ALL_LISTED.filter((id) => !real.has(id))).toEqual([]);
  });

  it("never lists a migration twice, or in two lists", () => {
    expect(new Set(ALL_LISTED).size).toBe(ALL_LISTED.length);
  });

  it("points every automatic migration at a file that exists", () => {
    for (const id of AUTO) {
      expect(existsSync(join(ROOT, "src", "lib", "db", `${id}.ts`)), id).toBe(true);
    }
  });

  it("keeps privilege-granting and destructive work OUT of the automatic list", () => {
    // A push must never be able to hand out the highest role, seed users,
    // rewrite data or reset the database.
    for (const id of AUTO) {
      expect(id, id).not.toMatch(/technical-lead|super-admin|seed|backfill|reset/);
    }
    expect(MANUAL).toContain("add-technical-lead");
    expect(AUTO).not.toContain("add-technical-lead");
  });

  it("freezes the legacy list", () => {
    // Nothing new belongs here; new work goes in the other two lists.
    expect(LEGACY_MIGRATIONS).toHaveLength(28);
  });

  it("explains why each manual migration is manual", () => {
    for (const m of MANUAL_MIGRATIONS) expect(m.why.length, m.id).toBeGreaterThan(30);
  });

  it("orders role rank before anything that depends on it", () => {
    // The session loader and the role screens read roles.rank, so it has to be
    // in place before the new code serves a request.
    expect(AUTO.indexOf("add-role-rank")).toBeGreaterThanOrEqual(0);
    expect(AUTO.indexOf("add-role-rank")).toBeLessThan(
      AUTO.indexOf("add-technical-permissions"),
    );
  });

  it("gives every probe a plain SELECT, and never a write", () => {
    // A probe runs against production on every first deploy. It must only ask.
    for (const m of DEPLOY_MIGRATIONS) {
      if (!m.appliedProbe) continue;
      expect(m.appliedProbe.trim(), m.id).toMatch(/^select\b/i);
      expect(m.appliedProbe, m.id).not.toMatch(
        /\b(insert|update|delete|drop|alter|create|truncate|grant)\b/i,
      );
    }
  });

  it("gives every automatic migration a description", () => {
    for (const m of DEPLOY_MIGRATIONS) expect(m.description.length, m.id).toBeGreaterThan(10);
  });
});

describe("the automatic scripts are additive", () => {
  // Rule 1 in migration-manifest.ts. A crude textual check, but it is the one
  // that would catch somebody pasting a DROP TABLE into a script that runs on
  // every production build.
  for (const id of AUTO) {
    it(`${id} contains no destructive statement`, () => {
      const src = readFileSync(join(ROOT, "src", "lib", "db", `${id}.ts`), "utf8")
        // Comments may legitimately say "never drop" — only code counts.
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
        .join("\n");
      expect(src).not.toMatch(/\bDROP\s+(TABLE|COLUMN|SCHEMA|DATABASE)\b/i);
      expect(src).not.toMatch(/\bTRUNCATE\b/i);
      expect(src).not.toMatch(/\bDELETE\s+FROM\s+"?(tickets|users|messages|audit_log|organizations)\b/i);
    });
  }
});

describe("the build hook", () => {
  it("runs the migrations before the build, on Vercel only", () => {
    // `vercel-build` is what Vercel runs in place of `build`. Putting the
    // runner there means GitHub CI (which runs `build`) never migrates.
    expect(pkg.scripts["vercel-build"]).toMatch(
      /deploy-migrations\.ts\s*&&\s*next build/,
    );
    expect(pkg.scripts.build).toBe("next build");
  });

  it("offers a plan mode that writes nothing, and a forced manual run", () => {
    expect(pkg.scripts["db:deploy-migrations:plan"]).toContain("--plan");
    expect(pkg.scripts["db:deploy-migrations"]).toContain("--force");
  });
});
