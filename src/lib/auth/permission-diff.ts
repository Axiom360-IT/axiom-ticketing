import { ALL_PERMISSIONS, type Permission } from "./permissions";

/**
 * "Can't grant what you don't have." Returns the set of permissions in
 * `requested` that the caller (`callerPermissions`) does NOT hold.
 * If the caller doesn't have ALL_PERMISSIONS in the wider sense (i.e.
 * isn't a Super Admin), they can't assign a role whose permissions
 * exceed their own.
 *
 * Lives outside app/actions/users.ts (a "use server" file, which can only
 * export async functions) so it can be shared with the MCP connector's
 * user-management tools without duplicating this logic.
 */
export function permissionsBeyondCaller(
  requested: Set<Permission>,
  callerPermissions: Set<Permission>,
): Permission[] {
  const callerIsAll = ALL_PERMISSIONS.every((p) => callerPermissions.has(p));
  if (callerIsAll) return [];
  const out: Permission[] = [];
  for (const p of requested) {
    if (!callerPermissions.has(p)) out.push(p);
  }
  return out;
}

// ── Editing an existing role: judge the CHANGE, not the whole set ─────────
//
// `permissionsBeyondCaller` is right for a role being CREATED, where every
// permission is new. It is wrong for one being EDITED. A role can legitimately
// hold a permission its editor does not — the Technical Lead granted it, or
// the editor lost it later — and an edit that leaves that permission alone
// must not be refused for it. Compared whole, such a role could not be saved
// by anyone restricted, and the error would name exactly the permission the
// "hidden" policy exists to keep out of sight.
//
// The delegation boundary has two edges, and both are enforced:
//   • you cannot ADD a permission you do not hold (can't grant what you lack)
//   • you cannot REMOVE one either (it is not yours to take away)
// The second is new. Previously a crafted request could strip a permission the
// editor could not even see, because omitting it passed the subset check.

export function permissionChanges(
  existing: Iterable<Permission>,
  requested: Iterable<Permission>,
): { added: Permission[]; removed: Permission[] } {
  const before = new Set(existing);
  const after = new Set(requested);
  return {
    added: [...after].filter((p) => !before.has(p)),
    removed: [...before].filter((p) => !after.has(p)),
  };
}

/** Changed permissions the caller has no authority over. Empty = allowed. */
export function changesBeyondCaller(
  changes: { added: Permission[]; removed: Permission[] },
  callerPermissions: Set<Permission>,
): Permission[] {
  const callerIsAll = ALL_PERMISSIONS.every((p) => callerPermissions.has(p));
  if (callerIsAll) return [];
  return [...changes.added, ...changes.removed].filter(
    (p) => !callerPermissions.has(p),
  );
}
