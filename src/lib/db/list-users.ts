/**
 * Diagnostic — prints every user with their assigned roles. Read-only,
 * changes nothing. Used to find the real Super Admin email before a reset.
 *
 * Run with:
 *   DATABASE_URL=<prod-url> pnpm db:list-users
 */

import { asc, eq } from "drizzle-orm";
import { db } from "./client";
import { users } from "./schema/auth";
import { roles, userRoles } from "./schema/rbac";

async function main() {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isActive: users.isActive,
      emailVerified: users.emailVerified,
    })
    .from(users)
    .orderBy(asc(users.email));

  if (rows.length === 0) {
    console.log("No users in the database.");
    process.exit(0);
  }

  // Role assignments, joined for display.
  const roleRows = await db
    .select({ userId: userRoles.userId, role: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId));

  const rolesByUser = new Map<string, string[]>();
  for (const r of roleRows) {
    const list = rolesByUser.get(r.userId) ?? [];
    list.push(r.role);
    rolesByUser.set(r.userId, list);
  }

  console.log(`${rows.length} user(s):\n`);
  for (const u of rows) {
    const rs = rolesByUser.get(u.id) ?? [];
    console.log(
      `  ${u.email}\n` +
        `    name: ${u.name}\n` +
        `    roles: ${rs.length > 0 ? rs.join(", ") : "(none)"}\n` +
        `    active: ${u.isActive}  verified: ${u.emailVerified}\n`,
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
