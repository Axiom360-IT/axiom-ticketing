import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * `email_delivery_issues`: addresses our email provider will not deliver to.
 *
 * Additive and idempotent, so it is safe to run automatically on deploy (see
 * migration-manifest.ts). One statement per `db.execute` — the neon-http driver
 * rejects multi-statement strings.
 *
 * Run via `pnpm db:add-email-delivery-issues`, or let a production deploy do it.
 */
async function main(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "email_delivery_issues" (
      "email" text PRIMARY KEY,
      "status" text NOT NULL,
      "first_seen_at" timestamptz NOT NULL,
      "last_seen_at" timestamptz NOT NULL,
      "last_email_id" text,
      "last_subject" text,
      "resolved_at" timestamptz
    )
  `);
  await db.execute(
    sql`ALTER TABLE "email_delivery_issues" DROP CONSTRAINT IF EXISTS "email_delivery_issues_status_check"`,
  );
  await db.execute(sql`
    ALTER TABLE "email_delivery_issues" ADD CONSTRAINT "email_delivery_issues_status_check"
      CHECK ("status" IN ('suppressed','bounced','complained'))
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "email_delivery_issues_open_idx"
      ON "email_delivery_issues" ("last_seen_at") WHERE "resolved_at" IS NULL
  `);

  const [row] = (
    await db.execute(sql`SELECT count(*)::int AS n FROM "email_delivery_issues"`)
  ).rows as { n: number }[];
  console.log(`email_delivery_issues ready — ${row?.n ?? 0} rows`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
