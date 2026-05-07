import { eq, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "../db/client";
import { roles, rolePermissions, userRoles } from "../db/schema/rbac";
import { auth } from "./index";
import type { SessionUser } from "./can";
import type { Permission } from "./permissions";

/**
 * Returns the current request's session user, including all permissions and
 * role names resolved from the DB. Returns null if no active session.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session?.user) return null;

  const userId = session.user.id;

  const roleRows = await db
    .select({ name: roles.name, id: roles.id })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  const roleNames = new Set(roleRows.map((r) => r.name));

  const permRows =
    roleRows.length === 0
      ? []
      : await db
          .select({ permission: rolePermissions.permission })
          .from(rolePermissions)
          .where(
            inArray(
              rolePermissions.roleId,
              roleRows.map((r) => r.id),
            ),
          );

  const permissions = new Set(permRows.map((p) => p.permission as Permission));

  // Impersonation flag is added in M6 when the impersonation Server Action lands.
  const isImpersonating = false;

  return {
    id: userId,
    permissions,
    roleNames,
    isImpersonating,
  };
}

/** Throws if there's no active session. Use in Server Actions/Route Handlers. */
export async function requireSessionUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new Error("Unauthenticated");
  return u;
}
