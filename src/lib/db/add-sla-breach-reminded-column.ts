import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: add the `tickets.sla_breach_reminded_at` column the SLA
 * monitor's repeat-escalation relies on (mirrors migration 0019). Runs through
 * the app's OWN DB connection, so it works even when the Neon console SQL
 * editor is blocked (free-tier compute limit). `ADD COLUMN IF NOT EXISTS`
 * makes re-runs a no-op.
 *
 * Run via `pnpm db:add-sla-breach-column`.
 */
async function main(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "sla_breach_reminded_at" timestamp with time zone`,
  );
  console.log("✓ tickets.sla_breach_reminded_at is present.");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
