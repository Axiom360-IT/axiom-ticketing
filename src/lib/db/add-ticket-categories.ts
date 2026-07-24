import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: provision the admin-managed ticket categories (mirrors
 * migration 0024). Creates `ticket_categories`, seeds the original five (so
 * existing tickets keep a valid, labelled category — 'other' is the protected
 * default), and drops the old hard-coded CHECK on `tickets.category`.
 *
 * Runs through the app's OWN Neon connection. Safe to re-run.
 *
 * Run via `pnpm db:add-ticket-categories`.
 */
async function main(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "ticket_categories" (
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
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "ticket_categories_value_key" ON "ticket_categories" ("value")`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "ticket_categories_sort_idx" ON "ticket_categories" ("sort_order")`,
  );
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "ticket_categories_one_default_idx" ON "ticket_categories" ("is_default") WHERE "is_default" = true`,
  );

  await db.execute(sql`
    INSERT INTO "ticket_categories" ("value","label","sort_order","is_active","is_default") VALUES
      ('hardware','Hardware',1,true,false),
      ('software','Software',2,true,false),
      ('network','Network',3,true,false),
      ('access','Access',4,true,false),
      ('other','Other',5,true,true)
    ON CONFLICT ("value") DO NOTHING
  `);

  await db.execute(
    sql`ALTER TABLE "tickets" DROP CONSTRAINT IF EXISTS "tickets_category_check"`,
  );

  console.log("✓ ticket_categories is present (5 seeded, CHECK relaxed).");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
