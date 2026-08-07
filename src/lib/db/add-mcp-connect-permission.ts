import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: grant the new `mcp.connect` permission to Super
 * Admin, IT Director, and Coordinator (mirrors migration 0031). Needed
 * because `pnpm db:seed` only runs once against a fresh database — a
 * permission added to the code later never reaches an already-seeded
 * database's `role_permissions` table on its own.
 *
 * Run via `pnpm db:add-mcp-connect-permission`.
 */
async function main(): Promise<void> {
  await db.execute(sql`
    INSERT INTO "role_permissions" ("role_id", "permission")
    SELECT r.id, 'mcp.connect'
    FROM "roles" r
    WHERE r.name IN ('Super Admin', 'IT Director', 'Coordinator')
    ON CONFLICT DO NOTHING
  `);
  console.log("✓ mcp.connect granted to Super Admin, IT Director, Coordinator.");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
