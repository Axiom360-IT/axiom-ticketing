import { join } from "node:path";
import { sql } from "drizzle-orm";
import { isUndefinedTable } from "./pg-errors";
import { DEPLOY_MIGRATIONS, type DeployMigration } from "./migration-manifest";
import {
  decideRun,
  pendingMigrations,
  probeErrorMeansNotApplied,
} from "./migration-plan";
import { runMigrationScript } from "./run-migration-script";

/**
 * Runs the migrations a deploy needs, before the new code serves a request.
 *
 *   vercel-build      tsx src/lib/db/deploy-migrations.ts && next build
 *   pnpm db:deploy-migrations         run what is pending, by hand  (--force)
 *   pnpm db:deploy-migrations:plan    say what WOULD run; writes nothing (--plan)
 *
 * WHEN: only on a Vercel PRODUCTION build (VERCEL_ENV=production), or by hand
 * with --force. A preview build, GitHub CI and a laptop all skip — see
 * decideRun() for why that default matters.
 *
 * ORDER: Vercel switches traffic only once the build succeeds, so a migration
 * that runs here lands BEFORE any new code can read what it created. That is
 * the whole reason this lives in the build step and not after it.
 *
 * FAILURE: any failure exits non-zero, which fails the build, which leaves the
 * previous deployment serving. Migrations are additive (see
 * migration-manifest.ts), so that previous version runs fine against whatever
 * did get applied.
 *
 * ONCE: a ledger table records each migration by name after it succeeds, so a
 * routine deploy changes nothing. A migration is recorded only AFTER it ran, so
 * a failure is retried on the next deploy.
 *
 * Two overlapping builds may both run the same migration. That is safe because
 * they are idempotent; it is not prevented, because the HTTP database driver
 * cannot hold an advisory lock across statements.
 *
 * Never invoked by an automatic deploy: seeds, backfills, resets, and
 * add-technical-lead. See MANUAL_MIGRATIONS.
 */

const LEDGER = "deploy_migrations";

async function main(): Promise<void> {
  const plan = process.argv.includes("--plan");
  const force = process.argv.includes("--force");

  const decision = decideRun(
    {
      VERCEL_ENV: process.env.VERCEL_ENV,
      DATABASE_URL: process.env.DATABASE_URL,
      SKIP_DEPLOY_MIGRATIONS: process.env.SKIP_DEPLOY_MIGRATIONS,
    },
    // --plan counts as forced: it needs a database to read the ledger, and it
    // writes nothing, so it is safe to run from anywhere.
    { force: force || plan },
  );
  if (decision.action === "skip") {
    console.log(`[migrations] skipped — ${decision.reason}`);
    return;
  }
  if (decision.action === "fail") {
    console.error(`[migrations] ${decision.reason}`);
    process.exit(1);
  }

  // Imported only now: the client throws at import if DATABASE_URL is unset,
  // which would break every preview and CI build that correctly skips above.
  const { db } = await import("./client");

  async function appliedNames(): Promise<Set<string>> {
    try {
      const rows = (
        await db.execute(sql.raw(`SELECT "name" FROM "${LEDGER}"`))
      ).rows as { name: string }[];
      return new Set(rows.map((r) => r.name));
    } catch (err) {
      // No ledger yet. In --plan mode that is the normal first-run state and we
      // must not create it; in a real run it was created just above.
      if (isUndefinedTable(err)) return new Set();
      throw err;
    }
  }

  async function record(name: string): Promise<void> {
    await db.execute(
      sql`INSERT INTO "deploy_migrations" ("name") VALUES (${name}) ON CONFLICT DO NOTHING`,
    );
  }

  async function alreadyInPlace(m: DeployMigration): Promise<boolean> {
    if (!m.appliedProbe) return false;
    try {
      return (await db.execute(sql.raw(m.appliedProbe))).rows.length > 0;
    } catch (err) {
      const code =
        (err as { code?: string }).code ??
        (err as { cause?: { code?: string } }).cause?.code;
      if (probeErrorMeansNotApplied(code)) return false;
      throw err;
    }
  }

  if (!plan) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "deploy_migrations" (
        "name" text PRIMARY KEY,
        "applied_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  const pending = pendingMigrations(DEPLOY_MIGRATIONS, await appliedNames());
  console.log(
    `[migrations] ${plan ? "PLAN (nothing will be written) — " : ""}` +
      `${pending.length} of ${DEPLOY_MIGRATIONS.length} pending`,
  );
  if (pending.length === 0) return;

  let ran = 0;
  let adopted = 0;
  for (const m of pending) {
    if (await alreadyInPlace(m)) {
      console.log(`[migrations] ✓ ${m.id} — already in place, ${plan ? "would record" : "recording"} it`);
      if (!plan) await record(m.id);
      adopted++;
      continue;
    }

    if (plan) {
      console.log(`[migrations] → ${m.id} — WOULD RUN (${m.description})`);
      continue;
    }

    console.log(`[migrations] → ${m.id} — running (${m.description})`);
    const result = runMigrationScript(join(process.cwd(), "src", "lib", "db", `${m.id}.ts`));
    if (!result.ok) {
      // Fail the build. The previous deployment keeps serving.
      console.error(`[migrations] ✗ ${m.id} ${result.reason}. Failing the build so the previous version stays live.`);
      process.exit(1);
    }
    await record(m.id);
    ran++;
    console.log(`[migrations] ✓ ${m.id}`);
  }

  if (!plan) console.log(`[migrations] done — ${ran} run, ${adopted} adopted`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("[migrations] unexpected error:", err);
    process.exit(1);
  });
