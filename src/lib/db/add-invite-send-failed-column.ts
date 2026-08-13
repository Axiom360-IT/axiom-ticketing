import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: add the `users.invite_send_failed_at` column
 * (mirrors the schema change in lib/db/schema/auth.ts). Nullable, no
 * default — nothing to backfill on existing rows. Runs through the app's
 * OWN DB connection, so it works even when the Neon console SQL editor is
 * blocked (free-tier compute limit). `ADD COLUMN IF NOT EXISTS` makes
 * re-runs a no-op.
 *
 * Run via `pnpm db:add-invite-send-failed`.
 */
async function main(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invite_send_failed_at" timestamp with time zone`,
  );
  console.log("✓ users.invite_send_failed_at is present.");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
