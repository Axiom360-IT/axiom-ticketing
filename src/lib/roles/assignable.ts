import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import type { SessionUser } from "@/lib/auth/can";
import { ALL_PERMISSIONS } from "@/lib/auth/permissions";
import { rankOf, roleAssignability } from "@/lib/auth/rank";
import { getUndelegableDisplay } from "@/lib/auth/undelegable-display";
import { rolePermissions, roles } from "@/lib/db/schema/rbac";

// ── Which roles a person is offered when creating or editing a user ───────
//
// Used by the create-user and edit-user screens, replacing two different
// lists. The create screen offered EVERY role (and let the server refuse the
// ones you could not grant); the edit screen filtered by permissions only. Neither
// knew about rank, and neither could hide anything.
//
// A role is OFFERED to the caller when:
//   • they could assign it (they outrank it AND hold everything it grants), or
//   • the policy is `locked` — it is shown disabled, with a lock, or
//   • the person being edited ALREADY HOLDS it and it is not above the caller's
//     rank — shown locked so the form is not misleadingly empty. (A Super Admin
//     editing another Super Admin sees "Super Admin" held but not removable.
//     A role ABOVE the caller stays invisible under `hidden`, so the Technical
//     Lead does not appear on its own account's edit page to a Super Admin.)

export type RoleOption = { id: string; name: string; locked: boolean };

export async function roleOptionsFor(
  caller: SessionUser,
  opts: { heldRoleIds?: string[] } = {},
): Promise<RoleOption[]> {
  const [allRoles, display] = await Promise.all([
    db
      .select({ id: roles.id, name: roles.name, rank: roles.rank })
      .from(roles)
      .orderBy(roles.name),
    getUndelegableDisplay(),
  ]);

  const permRows =
    allRoles.length === 0
      ? []
      : await db
          .select({
            roleId: rolePermissions.roleId,
            permission: rolePermissions.permission,
          })
          .from(rolePermissions)
          .where(
            inArray(
              rolePermissions.roleId,
              allRoles.map((r) => r.id),
            ),
          );
  const permsByRole = new Map<string, string[]>();
  for (const r of permRows) {
    const list = permsByRole.get(r.roleId) ?? [];
    list.push(r.permission);
    permsByRole.set(r.roleId, list);
  }

  const callerRank = rankOf(caller);
  const callerHasAll = ALL_PERMISSIONS.every((p) => caller.permissions.has(p));
  const held = new Set(opts.heldRoleIds ?? []);

  return allRoles.flatMap((r) => {
    const state = roleAssignability({
      callerRank,
      callerPermissions: caller.permissions,
      callerHasAll,
      role: { rank: r.rank, permissions: permsByRole.get(r.id) ?? [] },
    });
    const locked = state !== "ok";
    const offered =
      display === "locked" ||
      !locked ||
      (held.has(r.id) && r.rank <= callerRank);
    return offered ? [{ id: r.id, name: r.name, locked }] : [];
  });
}

/**
 * For LISTS of users (chips, the role filter, the CSV export): under `hidden`,
 * the highest rank whose role names the caller may see. Roles above it are
 * dropped from view; `null` means show everything.
 *
 * Narrower than the picker rule on purpose — a list is describing people, not
 * offering a choice, so a role the caller merely cannot ASSIGN (a peer's Super
 * Admin chip, say) still shows. Only roles ranked ABOVE the caller are
 * withheld, which is what stops the Technical Lead's role name appearing on
 * its holder's row for everyone beneath it.
 */
export async function visibleRoleRankCeiling(
  caller: SessionUser,
): Promise<number | null> {
  return (await getUndelegableDisplay()) === "hidden" ? rankOf(caller) : null;
}
