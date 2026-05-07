import type { SessionUser } from "./can";
import { PRIVILEGED_PERMISSIONS } from "./permissions";

/**
 * A user is "privileged" if they hold any permission that requires mandatory
 * 2FA (per PRD §5.13). 2FA enforcement middleware checks this and redirects
 * to the forced-enrolment page if the user hasn't enrolled yet.
 */
export function isPrivilegedUser(user: SessionUser): boolean {
  if (user.roleNames.has("Super Admin")) return true;
  for (const p of PRIVILEGED_PERMISSIONS) {
    if (user.permissions.has(p)) return true;
  }
  return false;
}
