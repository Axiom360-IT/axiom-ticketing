import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: provision admin-managed ticket TYPES (mirrors migration
 * 0025). Creates `ticket_types`, seeds the five standard ITSM types
 * ('service_request' is the protected default), and adds `tickets.type`
 * defaulting to 'service_request' (so existing tickets are backfilled).
 *
 * Runs through the app's OWN Neon connection. Safe to re-run.
 *
 * Run via `pnpm db:add-ticket-types`.
 */
async function main(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "ticket_types" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "value" text NOT NULL,
      "label" text NOT NULL,
      "sort_order" integer DEFAULT 0 NOT NULL,
      "is_active" boolean DEFAULT true NOT NULL,
      "is_default" boolean DEFAULT false NOT NULL,
      "created_by_id" uuid REFERENCES "users"("id") ON DELETE set null,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);

  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "ticket_types_value_key" ON "ticket_types" ("value")`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "ticket_types_sort_idx" ON "ticket_types" ("sort_order")`,
  );
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "ticket_types_one_default_idx" ON "ticket_types" ("is_default") WHERE "is_default" = true`,
  );

  await db.execute(sql`
    INSERT INTO "ticket_types" ("value","label","sort_order","is_active","is_default") VALUES
      ('service_request','Service Request',1,true,true),
      ('incident','Incident',2,true,false),
      ('change','Change',3,true,false),
      ('project','Project',4,true,false),
      ('alert','Alert',5,true,false)
    ON CONFLICT ("value") DO NOTHING
  `);

  await db.execute(
    sql`ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "type" text DEFAULT 'service_request' NOT NULL`,
  );

  console.log("✓ ticket_types is present (5 seeded) + tickets.type added.");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
