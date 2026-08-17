import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: add `users.provisioned_at` (mirrors the schema
 * change in lib/db/schema/auth.ts) and backfill every EXISTING row as
 * already-provisioned (provisioned_at = created_at) — before this feature
 * existed, every row genuinely was fully set up, since the bulk-import
 * "stub" pathway didn't exist yet. `ADD COLUMN IF NOT EXISTS` makes the
 * column addition safe to re-run.
 *
 * UNLIKE this project's other add-*.ts scripts, the backfill step is NOT
 * safe to re-run once the feature is live: `WHERE provisioned_at IS NULL`
 * would then also catch genuine in-flight (or stuck) "provisioning" rows
 * and wrongly mark them complete, erasing the exact signal this feature
 * exists to surface. Run this once, before deploying the code that creates
 * stub rows — never again after.
 *
 * Run via `pnpm db:add-provisioned-at-column`.
 */
async function main(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "provisioned_at" timestamp with time zone`,
  );
  const result = await db.execute(
    sql`UPDATE "users" SET "provisioned_at" = "created_at" WHERE "provisioned_at" IS NULL`,
  );
  console.log(
    `✓ users.provisioned_at is present. Backfilled ${result.rowCount ?? 0} row(s).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
