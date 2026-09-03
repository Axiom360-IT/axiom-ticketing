import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: create `email_template_overrides` — the sparse
 * per-field store behind the admin "Email templates" page. A missing row
 * means "use the compiled-in default copy", so this table starts empty and
 * the app behaves identically until someone actually edits a template.
 *
 * Runs through the app's OWN Neon connection. Safe to re-run.
 *
 * Run via `pnpm db:add-email-template-overrides`.
 */
async function main(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "email_template_overrides" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "template_key" text NOT NULL,
      "locale" text DEFAULT 'en' NOT NULL,
      "field_key" text NOT NULL,
      "value" text NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "email_template_overrides_key_idx"
      ON "email_template_overrides" ("template_key", "locale", "field_key")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "email_template_overrides_template_idx"
      ON "email_template_overrides" ("template_key", "locale")
  `);

  console.log("✓ email_template_overrides table + indexes present.");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
