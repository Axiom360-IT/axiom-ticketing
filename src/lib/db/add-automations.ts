import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * Automations: run history (`automation_runs`) and user-created scheduled
 * reports (`scheduled_reports`).
 *
 * Idempotent — safe to re-run. One statement per `db.execute`, because the
 * neon-http driver rejects multi-statement strings. DEFAULT values are
 * literals in the SQL text, never `${}` interpolation: interpolation becomes a
 * bind parameter and Postgres will not accept a parameter in a DEFAULT.
 *
 * Run via `pnpm db:add-automations`.
 */
async function main(): Promise<void> {
  // ── automation_runs ────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "automation_runs" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "automation_id" text NOT NULL,
      "started_at" timestamptz NOT NULL DEFAULT now(),
      "finished_at" timestamptz,
      "status" text NOT NULL DEFAULT 'running',
      "summary" jsonb,
      "error" text
    )
  `);

  await db.execute(
    sql`ALTER TABLE "automation_runs" DROP CONSTRAINT IF EXISTS "automation_runs_status_check"`,
  );
  await db.execute(sql`
    ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_status_check"
      CHECK ("status" IN ('running','ok','skipped','error'))
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "automation_runs_automation_started_idx"
      ON "automation_runs" ("automation_id", "started_at" DESC)
  `);

  // ── scheduled_reports ──────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "scheduled_reports" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" text NOT NULL,
      "report" text NOT NULL,
      "range_days" integer NOT NULL DEFAULT 1,
      "format" text NOT NULL DEFAULT 'xlsx',
      "hour" integer NOT NULL,
      "minute" integer NOT NULL DEFAULT 0,
      "weekdays" jsonb NOT NULL DEFAULT '["Mon","Tue","Wed","Thu","Fri"]'::jsonb,
      "recipient_user_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "recipient_roles" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "recipient_emails" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "enabled" boolean NOT NULL DEFAULT true,
      "last_run_on" text,
      "last_status" text,
      "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const [name, expr] of [
    ["scheduled_reports_hour_check", sql`"hour" BETWEEN 0 AND 23`],
    ["scheduled_reports_minute_check", sql`"minute" BETWEEN 0 AND 59`],
    ["scheduled_reports_format_check", sql`"format" IN ('xlsx','csv','pdf')`],
    ["scheduled_reports_range_check", sql`"range_days" BETWEEN 1 AND 365`],
  ] as const) {
    await db.execute(
      sql`ALTER TABLE "scheduled_reports" DROP CONSTRAINT IF EXISTS ${sql.identifier(name)}`,
    );
    await db.execute(
      sql`ALTER TABLE "scheduled_reports" ADD CONSTRAINT ${sql.identifier(name)} CHECK (${expr})`,
    );
  }

  const [runs] = (
    await db.execute(sql`SELECT count(*)::int AS n FROM "automation_runs"`)
  ).rows as { n: number }[];
  const [reports] = (
    await db.execute(sql`SELECT count(*)::int AS n FROM "scheduled_reports"`)
  ).rows as { n: number }[];

  console.log(
    `automations ready — automation_runs: ${runs?.n ?? 0} rows, scheduled_reports: ${reports?.n ?? 0} rows`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
