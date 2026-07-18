import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: add the `tickets.customer_followup_sent_at` column the
 * customer-followup monitor relies on (mirrors migration 0022). Runs through the
 * app's OWN DB connection, so it works even when the Neon console SQL editor is
 * blocked (free-tier compute limit). `ADD COLUMN IF NOT EXISTS` makes re-runs a
 * no-op.
 *
 * Run via `pnpm db:add-customer-followup-column`.
 */
async function main(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "customer_followup_sent_at" timestamp with time zone`,
  );
  console.log("✓ tickets.customer_followup_sent_at is present.");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
