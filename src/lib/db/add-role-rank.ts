import { sql } from "drizzle-orm";
import { RANK, SUPER_ADMIN_ROLE } from "../auth/rank";
import { db } from "./client";

/**
 * Adds `roles.rank` and ranks the Super Admin role at 1.
 *
 * Idempotent — safe to re-run. One statement per `db.execute`, because the
 * neon-http driver rejects multi-statement strings.
 *
 * Run via `pnpm db:add-role-rank`. Run it BEFORE deploying the code that reads
 * the column. (The session loader tolerates a missing column for exactly this
 * window, but the roles screens do not, and a tolerated outage is still one.)
 *
 * Changes nobody's access: every role defaults to rank 0, which is where every
 * role except Super Admin already behaves. The Technical Lead role arrives in
 * a separate step (`pnpm db:add-technical-lead`).
 */
async function main(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "rank" integer NOT NULL DEFAULT 0
  `);

  await db.execute(
    sql`ALTER TABLE "roles" DROP CONSTRAINT IF EXISTS "roles_rank_check"`,
  );
  await db.execute(sql`
    ALTER TABLE "roles" ADD CONSTRAINT "roles_rank_check"
      CHECK ("rank" BETWEEN 0 AND ${sql.raw(String(RANK.TECHNICAL_LEAD))})
  `);

  // Only ever RAISES a rank. Re-running after the Technical Lead exists must
  // not be able to demote anything.
  await db.execute(sql`
    UPDATE "roles" SET "rank" = ${RANK.SUPER_ADMIN}
    WHERE "name" = ${SUPER_ADMIN_ROLE} AND "rank" < ${RANK.SUPER_ADMIN}
  `);

  const rows = (
    await db.execute(
      sql`SELECT "name", "rank" FROM "roles" ORDER BY "rank" DESC, "name"`,
    )
  ).rows as { name: string; rank: number }[];

  console.log("role ranks:");
  for (const r of rows) console.log(`  ${r.rank}  ${r.name}`);

  const sa = rows.find((r) => r.name === SUPER_ADMIN_ROLE);
  if (!sa || sa.rank < RANK.SUPER_ADMIN) {
    throw new Error(`${SUPER_ADMIN_ROLE} was not ranked ${RANK.SUPER_ADMIN}`);
  }
  console.log("✓ roles.rank ready");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
