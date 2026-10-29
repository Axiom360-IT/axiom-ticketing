"use server";

import { count, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { permissionsBeyondCaller } from "@/lib/auth/permission-diff";
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  type Permission,
} from "@/lib/auth/permissions";
import { canManageRank, rankOf } from "@/lib/auth/rank";
import {
  loadRoleForAuthority,
  roleDeleteRefusal,
  roleUpdateRefusal,
} from "@/lib/auth/role-authority";
import { getUndelegableDisplay } from "@/lib/auth/undelegable-display";
import { loadRoleDetail } from "@/lib/roles/detail";
import { requireSessionUser } from "@/lib/auth/session";
import { db, transactional } from "@/lib/db/client";
import {
  rolePermissions,
  roles,
  userRoles,
} from "@/lib/db/schema/rbac";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { enforceUserRateLimit } from "@/lib/ratelimit";

const PERMISSION_SET = new Set(PERMISSIONS);

function asPermissions(input: string[]): Permission[] {
  // Drop unknown strings rather than throwing — keeps the action robust
  // against stale UI state. The server is the source of truth.
  return input.filter((p): p is Permission =>
    PERMISSION_SET.has(p as Permission),
  );
}

// ── createRole ─────────────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  permissions: z.array(z.string()).default([]),
});

export type CreateRoleInput = z.infer<typeof createSchema>;
export type CreateRoleResult =
  | { ok: true; roleId: string }
  | { ok: false; error: string };

export async function createRole(
  input: CreateRoleInput,
): Promise<CreateRoleResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const data = parsed.data;
  const caller = await requireSessionUser();
  await enforceUserRateLimit("authCreateRole", caller.id);
  if (!(await can(caller, "roles.create", { type: "global" }, productionContext))) {
    throw new ForbiddenError();
  }
  const perms = new Set(asPermissions(data.permissions));
  const beyond = permissionsBeyondCaller(perms, caller.permissions);
  if (beyond.length > 0) {
    return {
      ok: false,
      error: `You can't grant permissions you don't hold: ${beyond.join(", ")}`,
    };
  }

  const [existing] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, data.name))
    .limit(1);
  if (existing) return { ok: false, error: "A role with that name already exists." };

  const [row] = await db
    .insert(roles)
    .values({
      name: data.name,
      description: data.description ?? null,
      isSystem: false,
      createdById: caller.id,
    })
    .returning({ id: roles.id });

  if (perms.size > 0) {
    await db
      .insert(rolePermissions)
      .values([...perms].map((p) => ({ roleId: row.id, permission: p })));
  }

  await audit({
    actorId: caller.id,
    action: "role.create",
    targetType: "role",
    targetId: row.id,
    after: { name: data.name, permissions: [...perms] },
  });

  revalidatePath("/admin/roles");
  return { ok: true, roleId: row.id };
}

// ── updateRole ─────────────────────────────────────────────────────

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  permissions: z.array(z.string()).optional(),
});

export type UpdateRoleInput = z.infer<typeof updateSchema>;
export type UpdateRoleResult = { ok: true } | { ok: false; error: string };

export async function updateRole(
  roleId: string,
  input: UpdateRoleInput,
): Promise<UpdateRoleResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const caller = await requireSessionUser();
  if (!(await can(caller, "roles.update", { type: "global" }, productionContext))) {
    throw new ForbiddenError();
  }

  const role = await loadRoleForAuthority(roleId);
  if (!role) throw new NotFoundError();

  // One shared decision for this action and the MCP tool: rank (you may only
  // change a role you strictly outrank), the system-role rule, and the
  // permission DELTA — see lib/auth/role-authority.ts.
  const requested = parsed.data.permissions
    ? asPermissions(parsed.data.permissions)
    : undefined;
  const refusal = await roleUpdateRefusal(caller, role, requested);
  if (refusal) return { ok: false, error: refusal };

  if (requested) {
    await transactional(async (tx) => {
      await tx
        .delete(rolePermissions)
        .where(eq(rolePermissions.roleId, roleId));
      if (requested.length > 0) {
        await tx.insert(rolePermissions).values(
          [...new Set(requested)].map((p) => ({ roleId, permission: p })),
        );
      }
    });
  }

  if (parsed.data.name || parsed.data.description !== undefined) {
    await db
      .update(roles)
      .set({
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(parsed.data.description !== undefined
          ? { description: parsed.data.description }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(roles.id, roleId));
  }

  await audit({
    actorId: caller.id,
    action: "role.update",
    targetType: "role",
    targetId: roleId,
    after: parsed.data,
  });

  revalidatePath("/admin/roles");
  revalidatePath(`/admin/roles/${roleId}`);
  return { ok: true };
}

// ── deleteRole ─────────────────────────────────────────────────────

export async function deleteRole(
  roleId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await requireSessionUser();
  if (!(await can(caller, "roles.delete", { type: "global" }, productionContext))) {
    throw new ForbiddenError();
  }
  const role = await loadRoleForAuthority(roleId);
  if (!role) throw new NotFoundError();
  const refusal = roleDeleteRefusal(caller, role);
  if (refusal) return { ok: false, error: refusal };
  if (role.isSystem) {
    return { ok: false, error: "System roles can't be deleted." };
  }

  // Refuse if anyone still holds the role.
  const [{ value: assigned }] = await db
    .select({ value: count() })
    .from(userRoles)
    .where(eq(userRoles.roleId, roleId));
  if (assigned > 0) {
    return {
      ok: false,
      error: `Role is still assigned to ${assigned} user(s). Reassign them first.`,
    };
  }

  await transactional(async (tx) => {
    await tx
      .delete(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId));
    await tx.delete(roles).where(eq(roles.id, roleId));
  });

  await audit({
    actorId: caller.id,
    action: "role.delete",
    targetType: "role",
    targetId: roleId,
    before: { name: role.name },
  });

  revalidatePath("/admin/roles");
  return { ok: true };
}

// ── Read helpers ───────────────────────────────────────────────────
//
// Both readers apply the Technical Lead's visibility policy
// (`permissions.undelegable_display`), and they apply it HERE rather than in
// the component, because these are server actions a browser can call directly:
// filtering only on the client would hide a role from the screen and still
// hand it over the wire.
//
//   hidden (default)  a role ranked above the caller does not exist as far as
//                     they can tell, and a role they CAN see lists only the
//                     permissions they themselves hold
//   locked            everything is returned, flagged so the UI can grey it out

export async function listRolesForAdmin() {
  const caller = await requireSessionUser();
  if (!(await can(caller, "roles.view", { type: "global" }, productionContext))) {
    throw new ForbiddenError();
  }

  const callerRank = rankOf(caller);
  const display = await getUndelegableDisplay();

  const allRoles = await db
    .select({
      id: roles.id,
      name: roles.name,
      description: roles.description,
      isSystem: roles.isSystem,
      rank: roles.rank,
    })
    .from(roles)
    .orderBy(roles.name);

  const visible = allRoles.filter(
    (r) => display === "locked" || r.rank <= callerRank,
  );

  const counts = new Map<string, number>();
  if (visible.length > 0) {
    const rows = await db
      .select({ roleId: userRoles.roleId, value: count() })
      .from(userRoles)
      .where(
        inArray(
          userRoles.roleId,
          visible.map((r) => r.id),
        ),
      )
      .groupBy(userRoles.roleId);
    for (const r of rows) counts.set(r.roleId, Number(r.value));
  }

  return visible.map(({ rank, ...r }) => ({
    ...r,
    userCount: counts.get(r.id) ?? 0,
    // May THIS caller change it? Drives whether the row offers edit/delete.
    manageable: canManageRank(callerRank, rank),
    // Ranked above the caller: shown greyed out (locked mode only).
    locked: rank > callerRank,
  }));
}

export async function getRoleDetail(roleId: string) {
  const caller = await requireSessionUser();
  if (!(await can(caller, "roles.view", { type: "global" }, productionContext))) {
    throw new ForbiddenError();
  }
  const detail = await loadRoleDetail(roleId);
  if (!detail) return null;

  const display = await getUndelegableDisplay();
  if (display === "hidden") {
    // A role above the caller does not exist as far as they can tell.
    if (detail.rank > rankOf(caller)) return null;
    // And they see only the permissions they could themselves hand out.
    const callerHasAll = ALL_PERMISSIONS.every((p) => caller.permissions.has(p));
    if (!callerHasAll) {
      detail.permissions = detail.permissions.filter((p) =>
        caller.permissions.has(p),
      );
    }
  }
  return detail;
}
