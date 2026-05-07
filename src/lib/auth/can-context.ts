import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema/auth";
import { roles, userRoles } from "../db/schema/rbac";
import type { CanContext } from "./can";

// Production DB-backed context for `can()`. Server Actions and Route Handlers
// pass this when invoking can(). Tests pass mock contexts and never import
// this file (which would pull in the DB client).

async function dbIsDescendantOf(
  targetId: string,
  actorId: string,
): Promise<boolean> {
  // Walk up the created_by chain from target. If we hit actor, true.
  // Cap at 50 levels to defend against malformed data / circular hierarchies.
  let currentId: string | null = targetId;
  for (let depth = 0; depth < 50; depth++) {
    if (currentId === null) return false;
    const result = await db
      .select({ createdById: users.createdById })
      .from(users)
      .where(eq(users.id, currentId))
      .limit(1);
    if (result.length === 0) return false;
    if (result[0].createdById === actorId) return true;
    currentId = result[0].createdById;
  }
  return false;
}

async function dbUserHasRole(
  userId: string,
  roleName: string,
): Promise<boolean> {
  const rows = await db
    .select({ roleId: roles.id })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(userRoles.userId, userId), eq(roles.name, roleName)))
    .limit(1);
  return rows.length > 0;
}

async function dbIsLastActiveSuperAdmin(userId: string): Promise<boolean> {
  const isSA = await dbUserHasRole(userId, "Super Admin");
  if (!isSA) return false;

  const others = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(users.id, userRoles.userId))
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(roles.name, "Super Admin"), eq(users.isActive, true)));

  return others.filter((o) => o.id !== userId).length === 0;
}

export const productionContext: CanContext = {
  isDescendantOf: dbIsDescendantOf,
  userHasRole: dbUserHasRole,
  isLastActiveSuperAdmin: dbIsLastActiveSuperAdmin,
};
