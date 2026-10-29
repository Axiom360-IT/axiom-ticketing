import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import type { Permission } from "@/lib/auth/permissions";
import { rolePermissions, roles } from "@/lib/db/schema/rbac";

// A role with its FULL permission set and rank.
//
// Lives outside app/actions/roles.ts on purpose: that file is "use server",
// and everything it exports becomes an endpoint any signed-in roles.viewer can
// call from the browser. The edit page needs the UNFILTERED set (the form must
// resubmit permissions the editor cannot see, or saving would silently strip
// them), while the endpoint a browser can call must apply the visibility
// policy. Two functions, two files, so the filtered one cannot be bypassed by
// calling the full one.

export type RoleDetailFull = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  rank: number;
  permissions: Permission[];
};

export async function loadRoleDetail(
  roleId: string,
): Promise<RoleDetailFull | null> {
  const [role] = await db
    .select({
      id: roles.id,
      name: roles.name,
      description: roles.description,
      isSystem: roles.isSystem,
      rank: roles.rank,
    })
    .from(roles)
    .where(eq(roles.id, roleId))
    .limit(1);
  if (!role) return null;
  const perms = await db
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId));
  return { ...role, permissions: perms.map((p) => p.permission as Permission) };
}
