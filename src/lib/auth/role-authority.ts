import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { rolePermissions, roles } from "@/lib/db/schema/rbac";
import type { SessionUser } from "./can";
import { changesBeyondCaller, permissionChanges } from "./permission-diff";
import { PERMISSIONS, type Permission } from "./permissions";
import {
  canManageRank,
  isAtLeastSuperAdmin,
  type RoleRankInfo,
  rankOf,
  roleChangesAboveAuthority,
  roleSetChanges,
} from "./rank";

// ── Who may change which role ─────────────────────────────────────────
//
// The decisions, in one place, for BOTH callers: the admin UI's server actions
// (app/actions/roles.ts, users.ts) and the MCP connector's tools
// (lib/mcp/roles-write.ts, users-write.ts). The MCP file already mirrors the
// actions almost line for line, and a mirror is how a guard ends up applied
// to one path and not the other — the same trap as the 65 places that write to
// `tickets`. So neither path decides anything itself; each asks here and gets
// back either `null` (allowed) or a sentence to show the user.
//
// The decisions themselves are pure and tested in rank.test.ts. This file only
// adds the database reads they need.
//
// Messages are deliberately GENERIC. They do not name the role or permission
// that was refused: under the default "hidden" policy the caller was never
// shown it, and an error that read "you can't change Technical Lead" would
// undo the hiding. The only way to reach one is a hand-built request.

export const REFUSE_ROLE = "You don't have authority to change that role.";
export const REFUSE_ASSIGNMENT =
  "You don't have authority to grant or remove one of those roles.";
export const REFUSE_PERMISSION =
  "You can't grant or remove a permission you don't hold yourself.";

export async function loadRoleRanks(roleIds: string[]): Promise<RoleRankInfo[]> {
  if (roleIds.length === 0) return [];
  return db
    .select({ id: roles.id, rank: roles.rank })
    .from(roles)
    .where(inArray(roles.id, [...new Set(roleIds)]));
}

/** Everything a permission check needs to know about a role. */
export async function loadRoleForAuthority(roleId: string) {
  const [role] = await db
    .select({
      id: roles.id,
      name: roles.name,
      isSystem: roles.isSystem,
      rank: roles.rank,
    })
    .from(roles)
    .where(eq(roles.id, roleId))
    .limit(1);
  return role ?? null;
}

async function currentPermissions(roleId: string): Promise<Permission[]> {
  const rows = await db
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId));
  const known = new Set<string>(PERMISSIONS);
  return rows.map((r) => r.permission).filter((p): p is Permission => known.has(p));
}

/**
 * May `caller` edit this role (and, if given, set these permissions on it)?
 * Returns a refusal sentence, or `null` if allowed.
 */
export async function roleUpdateRefusal(
  caller: SessionUser,
  role: { id: string; isSystem: boolean; rank: number },
  requestedPermissions: Permission[] | undefined,
): Promise<string | null> {
  // 1. Rank — the rule this whole module exists for.
  if (!canManageRank(rankOf(caller), role.rank)) return REFUSE_ROLE;

  if (requestedPermissions === undefined) return null;

  // 2. A system role's permission set is for the Super Admin tier and above
  //    (Meeting-2, CR-27). Name and description stay editable by anyone with
  //    roles.update.
  if (role.isSystem && !isAtLeastSuperAdmin(caller)) {
    return "Only the Super Admin can change a system role's permissions.";
  }

  // 3. The permission DELTA, both edges. Judged as a change rather than as a
  //    whole set so a role that holds something the editor cannot see can
  //    still be saved by them, as long as they leave that thing alone.
  const changes = permissionChanges(
    await currentPermissions(role.id),
    requestedPermissions,
  );
  if (changesBeyondCaller(changes, caller.permissions).length > 0) {
    return REFUSE_PERMISSION;
  }
  return null;
}

/** May `caller` delete this role? (Whether it is a system role, or still
 *  assigned, is the caller's own existing check and is left where it is.) */
export function roleDeleteRefusal(
  caller: SessionUser,
  role: { rank: number },
): string | null {
  return canManageRank(rankOf(caller), role.rank) ? null : REFUSE_ROLE;
}

/**
 * May `caller` take a user from role set `before` to role set `after`?
 *
 * Only roles actually ADDED or REMOVED are judged, so editing another
 * person's profile through a form that resubmits their existing roles is
 * unaffected. What a Super Admin cannot do is make a Super Admin, unmake one,
 * or touch the Technical Lead role.
 */
export async function roleAssignmentRefusal(
  caller: SessionUser,
  before: string[],
  after: string[],
): Promise<string | null> {
  const { added, removed } = roleSetChanges(before, after);
  const touched = [...added, ...removed];
  if (touched.length === 0) return null;

  const known = await loadRoleRanks(touched);
  const blocked = roleChangesAboveAuthority(rankOf(caller), before, after, known);
  return blocked.length > 0 ? REFUSE_ASSIGNMENT : null;
}
