import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: create the `audit_filter_presets` table (mirrors
 * migration 0029) — named, team-shared audit-log filter bookmarks.
 *
 * Run via `pnpm db:add-audit-filter-presets`.
 */
async function main(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "audit_filter_presets" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "name" text NOT NULL,
      "query_string" text NOT NULL,
      "created_by_id" uuid,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "audit_filter_presets" ADD CONSTRAINT "audit_filter_presets_created_by_id_fk"
        FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "audit_filter_presets_name_key" ON "audit_filter_presets" USING btree ("name")
  `);
  console.log("✓ audit_filter_presets table is present.");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
