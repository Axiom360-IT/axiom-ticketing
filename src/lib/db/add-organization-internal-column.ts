import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: add `organizations.is_internal` (mirrors the schema
 * change in lib/db/schema/organizations.ts) and seed exactly one internal
 * org row for Axiom360 itself.
 *
 * Deliberately does NOT insert any organization_domains row for
 * axiom360.it — staff are already recognized independently by role
 * (isStaffUser / classifyStream), and a domain mapping here would risk
 * auto-linking/auto-billing real inbound tickets to this org. This row
 * exists purely as a record, visible only through the admin organizations
 * list's dedicated filter — never wired into ticket routing or billing.
 *
 * Run via `pnpm db:add-organization-internal-column`.
 */
async function main(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "is_internal" boolean NOT NULL DEFAULT false`,
  );

  // Key the guard on name/abbreviation as well as the flag. Checking only
  // `is_internal = true` matches nothing on a first run, so a pre-existing org
  // called Axiom360 (or coded AXIOM) would send the INSERT into a 23505 on the
  // unique indexes — AFTER the ALTER above has already committed, since the
  // neon-http driver runs each statement on its own. Comparing case-insensitively
  // because the DB indexes are case-SENSITIVE: a stray 'AXIOM360' would
  // otherwise slip past and create a second Axiom row.
  const existingResult = await db.execute(
    sql`SELECT id, name, is_internal FROM "organizations"
        WHERE "is_internal" = true
           OR lower("name") = 'axiom360'
           OR upper("abbreviation") = 'AXIOM'
        LIMIT 1`,
  );
  const [existing] = (existingResult.rows ?? existingResult) as {
    id: string;
    name: string;
    is_internal: boolean;
  }[];
  if (existing) {
    console.log(
      existing.is_internal
        ? `✓ Internal org already seeded (${existing.id}).`
        : `✓ Column added. An org named "${existing.name}" (${existing.id}) already occupies the Axiom360/AXIOM name; NOT seeding a second row. Flag it manually if that IS the internal org:\n    UPDATE organizations SET is_internal = true WHERE id = '${existing.id}';`,
    );
    return;
  }

  await db.execute(
    sql`INSERT INTO "organizations" (id, name, abbreviation, is_monthly_plan, is_active, is_internal)
        VALUES (${randomUUID()}, 'Axiom360', 'AXIOM', false, true, true)`,
  );
  console.log("✓ organizations.is_internal is present. Seeded the Axiom360 internal org row.");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
