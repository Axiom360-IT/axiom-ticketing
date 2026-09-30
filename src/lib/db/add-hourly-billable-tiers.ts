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
 * Order matters, in two ways:
 *  1. The OLD constraint must be dropped BEFORE the UPDATE — the old
 *     constraint doesn't allow 'hourly_regular', so writing it while the old
 *     constraint is still in place fails (23514).
 *  2. The UPDATE must run BEFORE the NEW constraint is added — otherwise the
 *     ADD CONSTRAINT would fail validating the surviving 'yes' rows.
 *
 * The neon-http driver has no transaction support, so we run a pre-check
 * first: if any row holds a value the new constraint would reject, we abort
 * BEFORE touching anything (the table is never left without a constraint
 * because of bad data). Safe to re-run.
 *
 * Run via `pnpm db:add-hourly-billable-tiers`.
 */
async function main(): Promise<void> {
  // 1. Pre-check: abort if any value would violate the NEW constraint after
  //    'yes' is migrated.
  const unexpected = await db.execute(
    sql`SELECT "billable", count(*)::int AS n FROM "tickets"
        WHERE "billable" IS NOT NULL
          AND "billable" NOT IN ('yes','hourly_regular','hourly_premium','no','monthly_plan','project','rework')
        GROUP BY "billable"`,
  );
  if ((unexpected.rows?.length ?? 0) > 0) {
    console.error("Unexpected billable values found — aborting, nothing changed:");
    console.error(unexpected.rows);
    throw new Error("Unexpected billable values; fix them and re-run.");
  }

  const before = await db.execute(
    sql`SELECT count(*)::int AS n FROM "tickets" WHERE "billable" = 'yes'`,
  );
  const pending = Number(
    (before.rows?.[0] as { n?: number } | undefined)?.n ?? 0,
  );

  // 2. Drop the OLD constraint first so 'hourly_regular' can be written.
  await db.execute(
    sql`ALTER TABLE "tickets" DROP CONSTRAINT IF EXISTS "tickets_billable_check"`,
  );

  // 3. Migrate the data.
  await db.execute(
    sql`UPDATE "tickets" SET "billable" = 'hourly_regular' WHERE "billable" = 'yes'`,
  );

  // 4. Add the NEW constraint (validates all rows).
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
