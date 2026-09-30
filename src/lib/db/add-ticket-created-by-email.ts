import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: add `tickets.created_by_email` — who RAISED a ticket,
 * lower-cased, stamped once at creation and never rewritten.
 *
 * Needed because none of the existing columns can answer "may this person
 * manage the participants on this ticket?":
 *   - `created_by_id` is NULL on exactly the guest and inbound tickets where
 *     it matters most, and is documented as visibility-not-attribution.
 *   - `customer_email` is rewritable by setTicketCustomer, which would
 *     silently transfer creator rights to whoever it was pointed at.
 *
 * The backfill hands out nothing new: `customer_email` is precisely who has
 * been able to act on that ticket via its guest link since the day it was
 * created.
 *
 * One statement per execute — Neon's HTTP driver takes a single statement per
 * call (see every other db:add-* script).
 *
 * Run via `pnpm db:add-ticket-created-by-email`.
 */
async function main(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "created_by_email" text`,
  );
  const res = await db.execute(sql`
    UPDATE "tickets" SET "created_by_email" = lower("customer_email")
      WHERE "created_by_email" IS NULL
  `);
  const filled = (res as { rowCount?: number }).rowCount ?? 0;

  console.log(
    `✓ tickets.created_by_email present; backfilled ${filled} row(s) from customer_email.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
