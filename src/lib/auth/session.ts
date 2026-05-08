import { eq, inArray } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { db } from "../db/client";
import { roles, rolePermissions, userRoles } from "../db/schema/rbac";
import { auth } from "./index";
import type { SessionUser } from "./can";
import type { Permission } from "./permissions";
import {
  IMPERSONATION_COOKIE,
  verifyImpersonationToken,
} from "./impersonation";

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
 * `isImpersonating: true`. Returns null if no active session.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session?.user) return null;

  const realUserId = session.user.id;
  const imp = await getActiveImpersonation();
  const effectiveUserId = imp ? imp.targetId : realUserId;

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

/**
 * Resolve the audit actor pair for the current request:
 *   - actorId        = impersonated user id when impersonating, else real
 *   - impersonatorId = real admin id when impersonating, else null
 *
 * Used by `audit()` to attribute writes correctly so reports always show
 * "X did this while impersonating Y" — never just one or the other.
 */
export async function getAuditActorIds(): Promise<{
  actorId: string | null;
  impersonatorId: string | null;
}> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session?.user) return { actorId: null, impersonatorId: null };
  const imp = await getActiveImpersonation();
  if (imp) {
    return { actorId: imp.targetId, impersonatorId: imp.impersonatorId };
  }
  return { actorId: session.user.id, impersonatorId: null };
}
