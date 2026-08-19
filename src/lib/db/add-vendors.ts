import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: provision the admin-managed vendor list (mirrors
 * migration 0032). Creates `vendors` and seeds the vendor list currently in
 * use for procurement requests.
 *
 * Runs through the app's OWN Neon connection. Safe to re-run.
 *
 * Run via `pnpm db:add-vendors`.
 */

const SEED_VENDORS = [
  "Amazon",
  "Barracuda",
  "Battery UPS For Less",
  "BD Micro",
  "BitTitan",
  "Best Buy",
  "Canada Computers & Electronics",
  "CDW Canada",
  "Climb Channel Solutions",
  "D&H Canada",
  "Datto / Kaseya",
  "Dell",
  "Evolve",
  "Fibernetics Corp",
  "GoDaddy",
  "Hostine",
  "HP",
  "ISDecision",
  "KGPCo Canada",
  "Knowbe4",
  "Microsoft",
  "NewEgg Canada",
  "Sherweb",
  "ShoppersPlus",
  "SURGE ARREST CANADA INC.",
  "Ubiquity Inc",
  "UBNT.ca",
];

async function main(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "vendors" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "name" text NOT NULL,
      "is_active" boolean DEFAULT true NOT NULL,
      "created_by_id" uuid REFERENCES "users"("id") ON DELETE set null,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);

  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "vendors_name_lower_key" ON "vendors" (lower("name"))`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "vendors_active_idx" ON "vendors" ("is_active")`,
  );

  for (const name of SEED_VENDORS) {
    await db.execute(
      sql`INSERT INTO "vendors" ("name") VALUES (${name}) ON CONFLICT DO NOTHING`,
    );
  }

  console.log(`✓ vendors is present (${SEED_VENDORS.length} seeded).`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
