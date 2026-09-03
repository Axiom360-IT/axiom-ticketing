import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: add `tickets.service_type` (onsite | remote | hybrid,
 * default 'remote' so every existing ticket gets a value) and widen
 * `work_logs.service_type`'s CHECK to also allow 'hybrid' — a logged entry
 * snapshots whatever the ticket said at the time (including hybrid), even
 * though the per-entry picker in the UI is going away.
 *
 * The DEFAULT value below is a literal in the SQL text, never a `${}`
 * interpolation — Neon's HTTP driver rejects a parameterized DEFAULT in an
 * ALTER TABLE (see the ticket-type-icon column script for the same gotcha).
 *
 * Runs through the app's OWN Neon connection. Safe to re-run.
 *
 * Run via `pnpm db:add-ticket-service-type`.
 */
async function main(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "tickets"
      ADD COLUMN IF NOT EXISTS "service_type" text NOT NULL DEFAULT 'remote'
  `);
  await db.execute(
    sql`ALTER TABLE "tickets" DROP CONSTRAINT IF EXISTS "tickets_service_type_check"`,
  );
  await db.execute(sql`
    ALTER TABLE "tickets" ADD CONSTRAINT "tickets_service_type_check"
      CHECK ("service_type" IN ('onsite','remote','hybrid'))
  `);

  await db.execute(
    sql`ALTER TABLE "work_logs" DROP CONSTRAINT IF EXISTS "work_logs_service_type_check"`,
  );
  await db.execute(sql`
    ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_service_type_check"
      CHECK ("service_type" IN ('onsite','remote','hybrid'))
  `);

  console.log(
    "✓ tickets.service_type present (default 'remote'); work_logs.service_type now also allows 'hybrid'.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
