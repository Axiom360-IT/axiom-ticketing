import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: split the single "Billable / per hour" billable value
 * ('yes') into two tiers — 'hourly_regular' and 'hourly_premium'.
 *
 * Every existing ticket tagged 'yes' becomes 'hourly_regular' (the client's
 * call: the old single rate is the regular rate). 'yes' is then removed from
 * the CHECK constraint entirely, so nothing can write it again.
 *
 * Order matters: the rows must be migrated BEFORE the new constraint is
 * applied, or the ALTER would fail validating the surviving 'yes' rows.
 *
 * Run via `pnpm db:add-hourly-billable-tiers`.
 */
async function main(): Promise<void> {
  const before = await db.execute(
    sql`SELECT count(*)::int AS n FROM "tickets" WHERE "billable" = 'yes'`,
  );
  const pending = Number(
    (before.rows?.[0] as { n?: number } | undefined)?.n ?? 0,
  );

  await db.execute(
    sql`UPDATE "tickets" SET "billable" = 'hourly_regular' WHERE "billable" = 'yes'`,
  );

  await db.execute(
    sql`ALTER TABLE "tickets" DROP CONSTRAINT IF EXISTS "tickets_billable_check"`,
  );
  await db.execute(sql`
    ALTER TABLE "tickets" ADD CONSTRAINT "tickets_billable_check"
      CHECK ("billable" IS NULL OR "billable" IN ('hourly_regular','hourly_premium','no','monthly_plan','project','rework'))
  `);

  console.log(
    `✓ billable tiers split: ${pending} ticket(s) moved from 'yes' to 'hourly_regular'; CHECK now allows hourly_regular/hourly_premium and no longer allows 'yes'.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
