import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: add the `ticket_email_refs` table (RFC Message-ID →
 * ticket index for robust inbound threading) + the `tickets.created_via`
 * column (finer creation source than `origin`). Mirrors migration 0028.
 * `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` make re-runs a
 * no-op.
 *
 * Run via `pnpm db:add-email-threading`.
 */
async function main(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "ticket_email_refs" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "ticket_id" uuid NOT NULL REFERENCES "tickets"("id") ON DELETE CASCADE,
      "rfc_message_id" text NOT NULL UNIQUE,
      "direction" text NOT NULL DEFAULT 'inbound',
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "ticket_email_refs_ticket_id_idx" ON "ticket_email_refs" ("ticket_id")`,
  );
  await db.execute(
    sql`ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "created_via" text`,
  );
  console.log("✓ ticket_email_refs + tickets.created_via are present.");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
