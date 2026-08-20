import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: add `notification_preferences.in_app_enabled`
 * (mirrors the schema change in lib/db/schema/notifications.ts). Defaults
 * true so every existing row keeps today's unconditional in-app behavior —
 * only the customer prefs UI exposes a way to turn it off going forward.
 *
 * Uses sql.raw() for the literal DEFAULT clause — Neon's HTTP driver
 * rejects a parameterized DEFAULT in DDL (see DECISIONS.md).
 *
 * Run via `pnpm db:add-in-app-notification-column`.
 */
async function main(): Promise<void> {
  await db.execute(
    sql.raw(
      `ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "in_app_enabled" boolean NOT NULL DEFAULT true`,
    ),
  );
  console.log("✓ notification_preferences.in_app_enabled is present.");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
