// The groups the permission matrix shows, in display order.
//
// Lives apart from the component so a test can assert that EVERY permission
// lands in a group. The matrix used to keep this list privately, with eight
// entries — which meant `organizations.*` and `worklog.view_all` belonged to
// no group and were never rendered at all. A permission that is not rendered
// cannot be delegated, so it could only ever be held by Super Admin.

import { PERMISSIONS, type Permission } from "./permissions";

export const PERMISSION_MODULES = [
  "tickets",
  "procurement",
  "reports",
  "worklog",
  "organizations",
  "users",
  "roles",
  "rules",
  "settings",
  "audit",
  "mcp",
] as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export function moduleOf(permission: Permission): string {
  return permission.split(".")[0] ?? permission;
}

export function permissionsByModule(): Record<PermissionModule, Permission[]> {
  const out = Object.fromEntries(
    PERMISSION_MODULES.map((m) => [m, [] as Permission[]]),
  ) as Record<PermissionModule, Permission[]>;
  for (const p of PERMISSIONS) {
    const m = moduleOf(p);
    if ((PERMISSION_MODULES as readonly string[]).includes(m)) {
      out[m as PermissionModule].push(p);
    }
  }
  return out;
}
