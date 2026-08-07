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
