import { sql } from "drizzle-orm";
import { db } from "./client";
import { DEFAULT_TICKET_TYPE_ICON } from "@/lib/tickets/type-icon-keys";

/**
 * One-shot, idempotent: add the `ticket_types.icon` column (mirrors the
 * schema change in lib/db/schema/ticket-types.ts). Runs through the app's
 * OWN DB connection, so it works even when the Neon console SQL editor is
 * blocked (free-tier compute limit). `ADD COLUMN IF NOT EXISTS` makes
 * re-runs a no-op; existing rows backfill to the same default the column
 * declares, so every already-seeded type gets a sensible icon immediately.
 *
 * Run via `pnpm db:add-ticket-type-icon`.
 */
async function main(): Promise<void> {
  // DEFAULT can't be a bind parameter in DDL over Neon's HTTP driver (a
  // `${...}` interpolation in the `sql` tag becomes one and the ALTER TABLE
  // fails with "bind message supplies 1 parameters, but prepared statement
  // requires 0") — inline the literal via sql.raw, matching the same fix
  // already applied in add-ticket-types.ts for `tickets.type`'s default.
  await db.execute(
    sql.raw(
      `ALTER TABLE "ticket_types" ADD COLUMN IF NOT EXISTS "icon" text NOT NULL DEFAULT '${DEFAULT_TICKET_TYPE_ICON}'`,
    ),
  );
  console.log("✓ ticket_types.icon is present.");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
