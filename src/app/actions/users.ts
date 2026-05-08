"use server";

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { ALL_PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import {
  rolePermissions,
  roles as rolesTable,
  userRoles,
} from "@/lib/db/schema/rbac";
import { enforceUserRateLimit } from "@/lib/ratelimit";

class ForbiddenError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "ForbiddenError";
  }
}
class NotFoundError extends Error {
  constructor() {
    super("Not found");
    this.name = "NotFoundError";
  }
}

// ── Helpers ────────────────────────────────────────────────────────

async function loadUserScope(userId: string) {
  const [u] = await db
    .select({ id: users.id, createdById: users.createdById })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return u;
}

async function permissionsForRoles(roleIds: string[]): Promise<Set<Permission>> {
  if (roleIds.length === 0) return new Set();
  const rows = await db
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleId, roleIds));
  return new Set(rows.map((r) => r.permission as Permission));
}

/**
 * "Can't grant what you don't have." Returns the set of permissions in
 * `requested` that the caller (`callerPermissions`) does NOT hold.
 * If the caller doesn't have ALL_PERMISSIONS in the wider sense (i.e.
 * isn't a Super Admin), they can't assign a role whose permissions
 * exceed their own.
 */
function permissionsBeyondCaller(
  requested: Set<Permission>,
  callerPermissions: Set<Permission>,
): Permission[] {
  // Super Admin shortcut: holds every permission.
  const callerIsAll = ALL_PERMISSIONS.every((p) => callerPermissions.has(p));
  if (callerIsAll) return [];
  const out: Permission[] = [];
  for (const p of requested) {
    if (!callerPermissions.has(p)) out.push(p);
  }
  return out;
}

/**
 * Walk descendants of `rootId` via `createdById`. Cap depth at 50 levels
 * for safety. Returns a flat list of {id, name, createdById, depth}.
 */
export async function getDescendants(
  rootId: string,
): Promise<{ id: string; name: string; email: string; createdById: string | null; depth: number }[]> {
  const out: { id: string; name: string; email: string; createdById: string | null; depth: number }[] = [];
  const queue: { id: string; depth: number }[] = [{ id: rootId, depth: 0 }];
  const visited = new Set<string>([rootId]);
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (next.depth >= 50) continue;
    const children = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        createdById: users.createdById,
      })
      .from(users)
      .where(eq(users.createdById, next.id));
    for (const c of children) {
      if (visited.has(c.id)) continue;
      visited.add(c.id);
      out.push({ ...c, depth: next.depth + 1 });
      queue.push({ id: c.id, depth: next.depth + 1 });
    }
  }
  return out;
}

// ── createUser ─────────────────────────────────────────────────────

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(12).max(200),
  language: z.string().trim().min(2).max(10).default("en"),
  roleIds: z.array(z.string().uuid()).default([]),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type CreateUserResult =
  | { ok: true; userId: string }
  | { ok: false; error: string };

export async function createUser(
  input: CreateUserInput,
): Promise<CreateUserResult> {
  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const data = parsed.data;

  const caller = await requireSessionUser();
  await enforceUserRateLimit("authCreateUser", caller.id);
  if (!(await can(caller, "users.create", { type: "global" }, productionContext))) {
    throw new ForbiddenError();
  }

  // "Can't grant what you don't have"
  if (data.roleIds.length > 0) {
    const requested = await permissionsForRoles(data.roleIds);
    const beyond = permissionsBeyondCaller(requested, caller.permissions);
    if (beyond.length > 0) {
      return {
        ok: false,
        error: `You can't grant permissions you don't hold: ${beyond.join(", ")}`,
      };
    }
  }

  // Ensure email is unique up front so we can return a friendly error
  // before Better Auth's API throws.
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, data.email))
    .limit(1);
  if (existing) {
    return { ok: false, error: "A user with that email already exists." };
  }

  let createdId: string;
  try {
    const result = await auth.api.signUpEmail({
      body: {
        email: data.email,
        password: data.password,
        name: data.name,
      },
    });
    createdId = result.user.id;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not create user",
    };
  }

  // Apply application-specific fields and role assignments.
  await db
    .update(users)
    .set({
      createdById: caller.id,
      language: data.language,
      updatedAt: new Date(),
    })
    .where(eq(users.id, createdId));

  if (data.roleIds.length > 0) {
    await db.insert(userRoles).values(
      data.roleIds.map((roleId) => ({
        userId: createdId,
        roleId,
        assignedById: caller.id,
      })),
    );
  }

  await audit({
    actorId: caller.id,
    action: "user.create",
    targetType: "user",
    targetId: createdId,
    after: { email: data.email, roleIds: data.roleIds },
  });

  revalidatePath("/admin/users");
  return { ok: true, userId: createdId };
}

// ── updateUser ─────────────────────────────────────────────────────

const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  language: z.string().trim().min(2).max(10).optional(),
  roleIds: z.array(z.string().uuid()).optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UpdateUserResult = { ok: true } | { ok: false; error: string };

export async function updateUser(
  userId: string,
  input: UpdateUserInput,
): Promise<UpdateUserResult> {
  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const data = parsed.data;

  const caller = await requireSessionUser();
  const target = await loadUserScope(userId);
  if (!target) throw new NotFoundError();
  if (
    !(await can(
      caller,
      "users.update",
      { type: "user", user: { id: target.id, createdById: target.createdById } },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  if (data.roleIds) {
    const requested = await permissionsForRoles(data.roleIds);
    const beyond = permissionsBeyondCaller(requested, caller.permissions);
    if (beyond.length > 0) {
      return {
        ok: false,
        error: `You can't grant permissions you don't hold: ${beyond.join(", ")}`,
      };
    }
  }

  const before = await db
    .select({ name: users.name, language: users.language })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (data.name || data.language) {
    await db
      .update(users)
      .set({
        ...(data.name ? { name: data.name } : {}),
        ...(data.language ? { language: data.language } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  if (data.roleIds) {
    await db.transaction(async (tx) => {
      await tx.delete(userRoles).where(eq(userRoles.userId, userId));
      if (data.roleIds!.length > 0) {
        await tx.insert(userRoles).values(
          data.roleIds!.map((roleId) => ({
            userId,
            roleId,
            assignedById: caller.id,
          })),
        );
      }
    });
  }

  await audit({
    actorId: caller.id,
    action: "user.update",
    targetType: "user",
    targetId: userId,
    before: before[0] ?? null,
    after: data,
  });

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true };
}

// ── deactivateUser (with cascade) ─────────────────────────────────

export type CascadeOption = "move-up" | "cascade" | "reassign";

const deactivateSchema = z.object({
  cascade: z.enum(["move-up", "cascade", "reassign"]),
  reassignToId: z.string().uuid().optional(),
});

export type DeactivateUserResult =
  | { ok: true; affectedDescendants: number }
  | { ok: false; error: string };

export async function deactivateUser(
  userId: string,
  cascadeOption: CascadeOption,
  reassignToId?: string,
): Promise<DeactivateUserResult> {
  const parsed = deactivateSchema.safeParse({
    cascade: cascadeOption,
    reassignToId,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const caller = await requireSessionUser();
  const target = await loadUserScope(userId);
  if (!target) throw new NotFoundError();
  if (
    !(await can(
      caller,
      "users.deactivate",
      { type: "user", user: { id: target.id, createdById: target.createdById } },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  if (parsed.data.cascade === "reassign") {
    if (!parsed.data.reassignToId) {
      return { ok: false, error: "Pick a user to reassign descendants to." };
    }
    const reassign = await loadUserScope(parsed.data.reassignToId);
    if (!reassign) {
      return { ok: false, error: "Reassign target not found." };
    }
    if (parsed.data.reassignToId === userId) {
      return { ok: false, error: "Reassign target can't be the user being deactivated." };
    }
  }

  // 1. Direct children of the user being deactivated.
  const directChildren = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.createdById, userId));

  // 2. Apply cascade option.
  let affected = 0;
  await db.transaction(async (tx) => {
    if (parsed.data.cascade === "move-up") {
      // Children move up to the deactivated user's own creator.
      await tx
        .update(users)
        .set({ createdById: target.createdById, updatedAt: new Date() })
        .where(eq(users.createdById, userId));
      affected = directChildren.length;
    } else if (parsed.data.cascade === "reassign") {
      await tx
        .update(users)
        .set({
          createdById: parsed.data.reassignToId!,
          updatedAt: new Date(),
        })
        .where(eq(users.createdById, userId));
      affected = directChildren.length;
    } else {
      // cascade: deactivate every descendant (full tree).
      const descendants = await getDescendants(userId);
      if (descendants.length > 0) {
        await tx
          .update(users)
          .set({
            isActive: false,
            deactivatedAt: sql`now()`,
            deactivatedById: caller.id,
            updatedAt: new Date(),
          })
          .where(
            inArray(
              users.id,
              descendants.map((d) => d.id),
            ),
          );
      }
      affected = descendants.length;
    }

    await tx
      .update(users)
      .set({
        isActive: false,
        deactivatedAt: sql`now()`,
        deactivatedById: caller.id,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  });

  await audit({
    actorId: caller.id,
    action: "user.deactivate",
    targetType: "user",
    targetId: userId,
    after: { cascade: parsed.data.cascade, affectedDescendants: affected },
  });

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/hierarchy");
  return { ok: true, affectedDescendants: affected };
}

// ── reactivateUser ─────────────────────────────────────────────────

export async function reactivateUser(userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await requireSessionUser();
  if (
    !(await can(
      caller,
      "users.reactivate",
      { type: "global" },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }
  const target = await loadUserScope(userId);
  if (!target) throw new NotFoundError();

  await db
    .update(users)
    .set({
      isActive: true,
      deactivatedAt: null,
      deactivatedById: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  await audit({
    actorId: caller.id,
    action: "user.reactivate",
    targetType: "user",
    targetId: userId,
  });

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true };
}

// ── resetUserPassword ──────────────────────────────────────────────

export async function resetUserPassword(
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await requireSessionUser();
  const target = await loadUserScope(userId);
  if (!target) throw new NotFoundError();
  if (
    !(await can(
      caller,
      "users.reset_password",
      { type: "user", user: { id: target.id, createdById: target.createdById } },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  const [u] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) throw new NotFoundError();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    await auth.api.requestPasswordReset({
      body: {
        email: u.email,
        redirectTo: `${appUrl}/admin/login`,
      },
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not request reset",
    };
  }

  await audit({
    actorId: caller.id,
    action: "user.reset_password",
    targetType: "user",
    targetId: userId,
  });
  return { ok: true };
}

// ── Read helpers used by pages (kept here so the action file owns
//    the logic, and pages stay lean) ──────────────────────────────

export async function listUsersForAdmin(opts: {
  query?: string;
  roleId?: string;
  status?: "active" | "inactive" | "all";
}) {
  const caller = await requireSessionUser();
  if (!(await can(caller, "users.view", { type: "global" }, productionContext))) {
    throw new ForbiddenError();
  }

  const filters = [] as ReturnType<typeof eq>[];
  if (opts.status === "active") filters.push(eq(users.isActive, true));
  if (opts.status === "inactive") filters.push(eq(users.isActive, false));

  const where = filters.length > 0 ? and(...filters) : undefined;

  // We don't dedupe by user here because we project name/email/active and
  // attach role names separately to keep the SQL straightforward.
  const baseRows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      isActive: users.isActive,
      createdById: users.createdById,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(where);

  const userIds = baseRows.map((u) => u.id);
  const rolesByUser = new Map<string, { id: string; name: string }[]>();
  if (userIds.length > 0) {
    const roleJoin = await db
      .select({
        userId: userRoles.userId,
        roleId: rolesTable.id,
        roleName: rolesTable.name,
      })
      .from(userRoles)
      .innerJoin(rolesTable, eq(userRoles.roleId, rolesTable.id))
      .where(inArray(userRoles.userId, userIds));
    for (const r of roleJoin) {
      const list = rolesByUser.get(r.userId) ?? [];
      list.push({ id: r.roleId, name: r.roleName });
      rolesByUser.set(r.userId, list);
    }
  }

  let rows = baseRows.map((u) => ({
    ...u,
    roles: rolesByUser.get(u.id) ?? [],
  }));

  if (opts.query) {
    const q = opts.query.toLowerCase();
    rows = rows.filter(
      (u) =>
        u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }
  if (opts.roleId) {
    rows = rows.filter((u) => u.roles.some((r) => r.id === opts.roleId));
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

export async function listAllRoles() {
  return db
    .select({
      id: rolesTable.id,
      name: rolesTable.name,
      isSystem: rolesTable.isSystem,
    })
    .from(rolesTable)
    .where(ne(rolesTable.name, ""))
    .orderBy(rolesTable.name);
}
