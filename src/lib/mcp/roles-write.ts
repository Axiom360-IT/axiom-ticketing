import "server-only";
import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can, type SessionUser } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { permissionsBeyondCaller } from "@/lib/auth/permission-diff";
import { db, transactional } from "@/lib/db/client";
import { rolePermissions, roles, userRoles } from "@/lib/db/schema/rbac";

// Mirrors app/actions/roles.ts's mutating actions, adapted to take an
// explicit SessionUser and to look roles up by NAME instead of uuid.

const PERMISSION_SET = new Set(PERMISSIONS);
function asPermissions(input: string[]): Permission[] {
  return input.filter((p): p is Permission => PERMISSION_SET.has(p as Permission));
}

type Result = { ok: true; [k: string]: unknown } | { ok: false; error: string };

async function findRoleByName(name: string) {
  const [row] = await db
    .select({ id: roles.id, name: roles.name, isSystem: roles.isSystem })
    .from(roles)
    .where(eq(roles.name, name))
    .limit(1);
  return row ?? null;
}

// ── create_role ────────────────────────────────────────────────────────
// Mirrors createRole (app/actions/roles.ts ~60-118).
export async function createRoleViaMcp(
  user: SessionUser,
  input: { name: string; description?: string; permissions: string[] },
): Promise<Result> {
  if (!(await can(user, "roles.create", { type: "global" }, productionContext))) {
    return { ok: false, error: "You don't have permission to create roles." };
  }
  const perms = new Set(asPermissions(input.permissions));
  const beyond = permissionsBeyondCaller(perms, user.permissions);
  if (beyond.length > 0) {
    return { ok: false, error: `You can't grant permissions you don't hold: ${beyond.join(", ")}` };
  }

  const existing = await findRoleByName(input.name);
  if (existing) return { ok: false, error: "A role with that name already exists." };

  const [row] = await db
    .insert(roles)
    .values({ name: input.name, description: input.description ?? null, isSystem: false, createdById: user.id })
    .returning({ id: roles.id });

  if (perms.size > 0) {
    await db.insert(rolePermissions).values([...perms].map((p) => ({ roleId: row.id, permission: p })));
  }

  await audit({
    actorId: user.id,
    action: "role.create",
    targetType: "role",
    targetId: row.id,
    after: { name: input.name, permissions: [...perms], via: "mcp" },
  });

  return { ok: true, roleId: row.id };
}

// ── update_role ────────────────────────────────────────────────────────
// Mirrors updateRole (app/actions/roles.ts ~131-219).
export async function updateRoleViaMcp(
  user: SessionUser,
  roleName: string,
  changes: { name?: string; description?: string; permissions?: string[] },
): Promise<Result> {
  if (!(await can(user, "roles.update", { type: "global" }, productionContext))) {
    return { ok: false, error: "You don't have permission to update roles." };
  }
  const role = await findRoleByName(roleName);
  if (!role) return { ok: false, error: `No role found named "${roleName}".` };

  if (role.isSystem && changes.permissions !== undefined && !user.roleNames.has("Super Admin")) {
    return { ok: false, error: "Only the Super Admin can change a system role's permissions." };
  }

  if (changes.permissions) {
    const requested = new Set(asPermissions(changes.permissions));
    const beyond = permissionsBeyondCaller(requested, user.permissions);
    if (beyond.length > 0) {
      return { ok: false, error: `You can't grant permissions you don't hold: ${beyond.join(", ")}` };
    }
    await transactional(async (tx) => {
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
      if (requested.size > 0) {
        await tx.insert(rolePermissions).values([...requested].map((p) => ({ roleId: role.id, permission: p })));
      }
    });
  }

  if (changes.name || changes.description !== undefined) {
    await db
      .update(roles)
      .set({
        ...(changes.name ? { name: changes.name } : {}),
        ...(changes.description !== undefined ? { description: changes.description } : {}),
        updatedAt: new Date(),
      })
      .where(eq(roles.id, role.id));
  }

  await audit({
    actorId: user.id,
    action: "role.update",
    targetType: "role",
    targetId: role.id,
    after: { ...changes, via: "mcp" },
  });

  return { ok: true };
}

// ── delete_role ────────────────────────────────────────────────────────
// Mirrors deleteRole (app/actions/roles.ts ~223-269).
export async function deleteRoleViaMcp(user: SessionUser, roleName: string): Promise<Result> {
  if (!(await can(user, "roles.delete", { type: "global" }, productionContext))) {
    return { ok: false, error: "You don't have permission to delete roles." };
  }
  const role = await findRoleByName(roleName);
  if (!role) return { ok: false, error: `No role found named "${roleName}".` };
  if (role.isSystem) return { ok: false, error: "System roles can't be deleted." };

  const [{ value: assigned }] = await db.select({ value: count() }).from(userRoles).where(eq(userRoles.roleId, role.id));
  if (assigned > 0) {
    return { ok: false, error: `Role is still assigned to ${assigned} user(s). Reassign them first.` };
  }

  await transactional(async (tx) => {
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
    await tx.delete(roles).where(eq(roles.id, role.id));
  });

  await audit({
    actorId: user.id,
    action: "role.delete",
    targetType: "role",
    targetId: role.id,
    before: { name: role.name },
    after: { via: "mcp" },
  });

  return { ok: true };
}

// ── MCP tool registration ────────────────────────────────────────────────

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
const CONFIRM_NOTE =
  " Before calling this, always show the user exactly what will change and get their explicit go-ahead in the chat first — never call this on the first ask.";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerRoleWriteTools(server: any, user: SessionUser): void {
  server.registerTool(
    "create_role",
    {
      title: "Create a role",
      description:
        `Creates a custom role with a set of permissions. Valid permission strings: ${PERMISSIONS.join(", ")}. You can't grant a permission you don't hold yourself.` +
        CONFIRM_NOTE,
      inputSchema: { name: z.string().min(1), description: z.string().optional(), permissions: z.array(z.string()).default([]) },
    },
    async (input: { name: string; description?: string; permissions: string[] }) => {
      const r = await createRoleViaMcp(user, input);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "update_role",
    {
      title: "Update a role",
      description: "Updates a role's name, description, and/or permission set (by role name)." + CONFIRM_NOTE,
      inputSchema: {
        roleName: z.string().min(1),
        name: z.string().optional(),
        description: z.string().optional(),
        permissions: z.array(z.string()).optional(),
      },
    },
    async (input: { roleName: string; name?: string; description?: string; permissions?: string[] }) => {
      const r = await updateRoleViaMcp(user, input.roleName, {
        name: input.name,
        description: input.description,
        permissions: input.permissions,
      });
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "delete_role",
    {
      title: "Delete a role",
      description: "Deletes a custom role (system roles can't be deleted, and a role still assigned to anyone must be reassigned first)." + CONFIRM_NOTE,
      inputSchema: { roleName: z.string().min(1) },
    },
    async ({ roleName }: { roleName: string }) => {
      const r = await deleteRoleViaMcp(user, roleName);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );
}
