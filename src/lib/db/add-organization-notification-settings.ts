import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * `organization_notification_settings`: per-organization notification mutes.
 *
 * Additive and idempotent, so it is safe to run automatically on deploy (see
 * migration-manifest.ts). One statement per `db.execute` — the neon-http driver
 * rejects multi-statement strings.
 *
 * Run via `pnpm db:add-organization-notification-settings`, or let a production
 * deploy do it.
 */
async function main(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "organization_notification_settings" (
      "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "event_type" text NOT NULL,
      "email_enabled" boolean NOT NULL DEFAULT true,
      "sms_enabled" boolean NOT NULL DEFAULT true,
      "in_app_enabled" boolean NOT NULL DEFAULT true,
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY ("organization_id", "event_type")
    )
  `);

  const [row] = (
    await db.execute(
      sql`SELECT count(*)::int AS n FROM "organization_notification_settings"`,
    )
  ).rows as { n: number }[];
  console.log(`organization_notification_settings ready — ${row?.n ?? 0} rows`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
