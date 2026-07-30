import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: add the `users.invited_at` / `invite_expires_at` /
 * `invite_accepted_at` columns the customer bulk-import feature relies on
 * (mirrors migration 0027), plus seed the `customer_invite.expiry_hours`
 * setting these invites read at send time. `ADD COLUMN IF NOT EXISTS` and
 * `ON CONFLICT DO NOTHING` make re-runs a no-op.
 *
 * Run via `pnpm db:add-invite-status-columns`.
 */
async function main(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invited_at" timestamp with time zone`,
  );
  await db.execute(
    sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invite_expires_at" timestamp with time zone`,
  );
  await db.execute(
    sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invite_accepted_at" timestamp with time zone`,
  );
  console.log("✓ users.invited_at / invite_expires_at / invite_accepted_at are present.");

  await db.execute(sql`
    INSERT INTO "settings" ("key", "value", "description")
    VALUES (
      'customer_invite.expiry_hours',
      '72'::jsonb,
      'Hours a customer''s bulk-import ''set your password'' invite link stays valid'
    )
    ON CONFLICT ("key") DO NOTHING
  `);
  console.log("✓ setting customer_invite.expiry_hours is present.");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
