import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: add the `tickets.unassigned_reminder_at` column the
 * unassigned-ticket monitor relies on (mirrors migration 0018). Runs through
 * the app's OWN DB connection, so it works even when the Neon console SQL
 * editor is blocked (free-tier compute limit). `ADD COLUMN IF NOT EXISTS`
 * makes re-runs a no-op.
 *
 * Run via `pnpm db:add-unassigned-column`.
 */
async function main(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "unassigned_reminder_at" timestamp with time zone`,
  );
  console.log("✓ tickets.unassigned_reminder_at is present.");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
