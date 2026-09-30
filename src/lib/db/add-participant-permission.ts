import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: grant the new `tickets.manage_participants` permission
 * to the seeded roles.
 *
 * Needed because `pnpm db:seed` no-ops once any role exists, so on a live
 * database a permission added to the code's per-role arrays lands in ZERO
 * `role_permissions` rows — the feature then works locally on a fresh seed and
 * is invisible in production. Same pattern as add-mcp-connect-permission.ts.
 *
 * Super Admin holds ALL_PERMISSIONS and is included explicitly for databases
 * where its grants are enumerated rather than implied.
 *
 * Run via `pnpm db:add-participant-permission`.
 */
const ROLES = [
  "Super Admin",
  "IT Director",
  "Coordinator",
  "Technician",
  "Customer",
];

async function main(): Promise<void> {
  for (const role of ROLES) {
    await db.execute(sql`
      INSERT INTO role_permissions (role_id, permission)
      SELECT r.id, 'tickets.manage_participants' FROM roles r WHERE r.name = ${role}
      ON CONFLICT DO NOTHING
    `);
  }

  const res = await db.execute(sql`
    SELECT r.name FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      WHERE rp.permission = 'tickets.manage_participants'
      ORDER BY r.name
  `);
  const names = (res.rows as { name: string }[]).map((r) => r.name);
  console.log(
    `✓ tickets.manage_participants granted to: ${names.join(", ") || "(none — are the roles seeded?)"}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
