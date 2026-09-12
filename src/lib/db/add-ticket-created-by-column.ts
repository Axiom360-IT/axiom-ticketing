import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: add `tickets.created_by_id` (mirrors the schema change
 * in lib/db/schema/tickets.ts).
 *
 * Nullable with NO backfill, deliberately. The column exists so a strict
 * Technician who raises a ticket keeps sight of it; existing rows have no
 * recoverable creator (nothing recorded one), and guessing — e.g. stamping the
 * first message's author — would invent history and could hand someone
 * visibility they never had. NULL means "unknown creator", which is the honest
 * value and is exactly how the visibility leg treats it: no match, no access.
 *
 * Safe to re-run. Run via `pnpm db:add-ticket-created-by`.
 */
async function main(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "created_by_id" uuid`,
  );
  // FK added separately so a re-run doesn't trip over an existing constraint.
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tickets_created_by_id_fk'
      ) THEN
        ALTER TABLE "tickets"
          ADD CONSTRAINT "tickets_created_by_id_fk"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL;
      END IF;
    END $$;
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "tickets_created_by_id_idx" ON "tickets" ("created_by_id")`,
  );

  console.log("✓ tickets.created_by_id present (nullable, FK + index).");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
