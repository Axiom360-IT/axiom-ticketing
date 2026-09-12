import { and, eq, inArray } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { db } from "../db/client";
import { users } from "../db/schema/auth";
import { roles, rolePermissions, userRoles } from "../db/schema/rbac";
import { auth } from "./index";
import type { SessionUser } from "./can";
import type { Permission } from "./permissions";
import {
  IMPERSONATION_COOKIE,
  verifyImpersonationToken,
} from "./impersonation";

/**
 * Builds a full SessionUser from a raw user id — no cookie/request context
 * needed. Used by the MCP connector (bearer-token auth, not a browser
 * session) so tool calls run through the exact same can() permission logic
 * as everything else, instead of a parallel authorization path.
 *
 * Returns null when the user has been deactivated: a deactivated account
 * must be able to do nothing at all, and this is the single choke point
 * every non-browser caller goes through.
 */
export async function loadSessionUserById(
  userId: string,
): Promise<SessionUser | null> {
  if (!(await allUsersActive([userId]))) return null;
  const { permissions, roleNames } = await loadEffectivePerms(userId);
  return { id: userId, permissions, roleNames, isImpersonating: false };
}

/**
 * True only if every id given belongs to an existing, non-deactivated user.
 * Deactivation is enforced on every session resolution rather than only at
 * sign-in, so revoking someone's access takes effect on their very next
 * request — an already-issued session cookie or MCP token stops working
 * immediately instead of living on until it expires.
 */
async function allUsersActive(userIds: string[]): Promise<boolean> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return false;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.isActive, true)));
  return rows.length === ids.length;
}

async function loadEffectivePerms(
  userId: string,
): Promise<{ permissions: Set<Permission>; roleNames: Set<string> }> {
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
  const permissions = new Set(
    permRows.map((p) => p.permission as Permission),
  );
  return { permissions, roleNames };
}

/**
 * Returns the active impersonation context, if the current request carries
 * a valid signed `axiom_imp` cookie AND the actual signed-in user matches
 * the impersonator id baked into it. Returns `null` otherwise.
 */
export async function getActiveImpersonation(): Promise<
  { impersonatorId: string; targetId: string } | null
> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(IMPERSONATION_COOKIE)?.value;
  if (!raw) return null;
  const verified = verifyImpersonationToken(raw);
  if (!verified) return null;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  if (session.user.id !== verified.impersonatorId) return null;
  return verified;
}

/**
 * Returns the current request's session user, including all permissions and
 * role names resolved from the DB. When an impersonation cookie is in
 * effect, returns the IMPERSONATED user's id + permissions + roles, with
 * `isImpersonating: true`. Returns null if there is no active session, or
 * if either party to the request has been deactivated.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session?.user) return null;

  const realUserId = session.user.id;
  const imp = await getActiveImpersonation();
  const effectiveUserId = imp ? imp.targetId : realUserId;

  // Both parties must still be active. While impersonating, deactivating
  // either the impersonator or their target ends the request.
  if (!(await allUsersActive([realUserId, effectiveUserId]))) return null;

  const { permissions, roleNames } = await loadEffectivePerms(effectiveUserId);

  return {
    id: effectiveUserId,
    permissions,
    roleNames,
    isImpersonating: Boolean(imp),
  };
}

/** Throws if there's no active session. Use in Server Actions/Route Handlers. */
export async function requireSessionUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new Error("Unauthenticated");
  return u;
}

