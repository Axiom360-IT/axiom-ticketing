import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: provision the CSAT emoji-feedback schema (mirrors
 * migration 0023). Adds `tickets.csat_rating` (+ its CHECK), backfills it from
 * the legacy binary `csat_response`, and creates the `ticket_reviews` history
 * table with its FKs, CHECKs, and indexes.
 *
 * Runs through the app's OWN Neon connection, so it works even when the Neon
 * console SQL editor is blocked (free-tier compute limit). Every statement uses
 * IF NOT EXISTS / guarded DO blocks so re-runs are a no-op.
 *
 * Run via `pnpm db:add-csat-reviews`.
 */
async function main(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "csat_rating" text`,
  );

  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tickets_csat_rating_check'
      ) THEN
        ALTER TABLE "tickets" ADD CONSTRAINT "tickets_csat_rating_check"
          CHECK ("csat_rating" IS NULL OR "csat_rating" IN ('happy','neutral','unhappy'));
      END IF;
    END $$;
  `);

  // Backfill from the legacy binary response (safe to re-run — only fills NULLs
  // that have a response). Cannot distinguish happy vs neutral retroactively.
  await db.execute(sql`
    UPDATE "tickets" SET "csat_rating" = CASE
      WHEN "csat_response" = 'satisfied' THEN 'happy'
      WHEN "csat_response" = 'unsatisfied' THEN 'unhappy'
      ELSE "csat_rating"
    END
    WHERE "csat_response" IS NOT NULL AND "csat_rating" IS NULL
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "ticket_reviews" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "ticket_id" uuid NOT NULL REFERENCES "tickets"("id") ON DELETE restrict,
      "rating" text NOT NULL,
      "comment" text,
      "technician_id" uuid REFERENCES "users"("id") ON DELETE set null,
      "technician_name" text,
      "respondent_email" text NOT NULL,
      "respondent_id" uuid REFERENCES "users"("id") ON DELETE set null,
      "submitted_via" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "ticket_reviews_rating_check" CHECK ("rating" IN ('happy','neutral','unhappy')),
      CONSTRAINT "ticket_reviews_submitted_via_check" CHECK ("submitted_via" IN ('portal','email'))
    )
  `);

  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "ticket_reviews_ticket_id_idx" ON "ticket_reviews" ("ticket_id")`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "ticket_reviews_technician_id_idx" ON "ticket_reviews" ("technician_id")`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "ticket_reviews_created_at_idx" ON "ticket_reviews" ("created_at" DESC)`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "ticket_reviews_rating_idx" ON "ticket_reviews" ("rating")`,
  );

  console.log("✓ CSAT reviews schema is present (tickets.csat_rating + ticket_reviews).");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
