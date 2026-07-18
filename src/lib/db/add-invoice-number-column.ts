import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: add the `tickets.invoice_number` column the billing
 * status relies on (mirrors migration 0020). Runs through the app's OWN DB
 * connection, so it works even when the Neon console SQL editor is blocked
 * (free-tier compute limit). `ADD COLUMN IF NOT EXISTS` makes re-runs a no-op.
 *
 * Run via `pnpm db:add-invoice-column`.
 */
async function main(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "invoice_number" text`,
  );
  console.log("✓ tickets.invoice_number is present.");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
