import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: widen `ticket_participants` for the participants
 * feature — a `pending` status (proposed but not yet approved) and the new
 * `added_via` provenance values.
 *
 * `pending` rides on the existing table rather than a separate queue because
 * every current read path already filters `status='active'`, so a pending row
 * is inert with zero changes to existing queries, and the unique
 * (ticket_id, email) constraint dedupes repeat requests for free.
 *
 * CHECK constraints are a closed set, so each is dropped and re-added. One
 * statement per execute — Neon's HTTP driver takes a single statement a call.
 *
 * Run via `pnpm db:add-participant-pending`.
 */
async function main(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "ticket_participants" DROP CONSTRAINT IF EXISTS "ticket_participants_status_check"`,
  );
  await db.execute(sql`
    ALTER TABLE "ticket_participants" ADD CONSTRAINT "ticket_participants_status_check"
      CHECK ("status" IN ('pending','active','removed'))
  `);

  await db.execute(
    sql`ALTER TABLE "ticket_participants" DROP CONSTRAINT IF EXISTS "ticket_participants_added_via_check"`,
  );
  await db.execute(sql`
    ALTER TABLE "ticket_participants" ADD CONSTRAINT "ticket_participants_added_via_check"
      CHECK ("added_via" IN ('domain_auto','moderation','agent','requester','guest_request','recipient'))
  `);

  // The approval queue reads pending rows across every ticket.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ticket_participants_pending_idx"
      ON "ticket_participants" ("ticket_id") WHERE "status" = 'pending'
  `);

  console.log(
    "✓ ticket_participants: status now allows 'pending'; added_via allows requester/guest_request/recipient; pending index present.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
