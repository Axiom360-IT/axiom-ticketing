import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: create `dashboard_layouts` — one row per person holding
 * how they arranged their admin dashboard (widgets, positions, sizes, chart
 * types). Additive; nothing else is touched.
 *
 * The dashboard reads it inside a try/catch that treats "missing" as "use the
 * default layout", so shipping the code before this has run cannot break the
 * page — people just can't save a layout until it exists.
 *
 * Run via `pnpm db:add-dashboard-layouts`; on a production deploy the runner
 * applies it (see migration-manifest.ts).
 */
async function main(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "dashboard_layouts" (
      "user_id" uuid PRIMARY KEY NOT NULL,
      "layout" jsonb NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "dashboard_layouts" ADD CONSTRAINT "dashboard_layouts_user_id_users_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `);
  console.log("✓ dashboard_layouts table is present.");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
