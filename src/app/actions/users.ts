"use server";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { ALL_PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { db, transactional } from "@/lib/db/client";
import { accounts, users } from "@/lib/db/schema/auth";
import {
  rolePermissions,
  roles as rolesTable,
  userRoles,
} from "@/lib/db/schema/rbac";
import { clearFailures } from "@/lib/auth/lockout";
import { isReauthFresh, reauthRequiredResult } from "@/lib/auth/reauth";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { enforceUserRateLimit } from "@/lib/ratelimit";
import { getAppUrl } from "@/lib/request";

// ── Helpers ────────────────────────────────────────────────────────

async function loadUserScope(userId: string) {
  const [u] = await db
    .select({ id: users.id, createdById: users.createdById })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return u;
}

async function rolesIncludeSuperAdmin(roleIds: string[]): Promise<boolean> {
  if (roleIds.length === 0) return false;
  const rows = await db
    .select({ id: rolesTable.id })
    .from(rolesTable)
    .where(and(inArray(rolesTable.id, roleIds), eq(rolesTable.name, "Super Admin")))
    .limit(1);
  return rows.length > 0;
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
  language: z.string().trim().min(2).max(10).default("en"),
  roleIds: z.array(z.string().uuid()).default([]),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type CreateUserResult =
  | { ok: true; userId: string }
  | { ok: false; error: string; reauthRequired?: true };

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

  // M17: granting Super Admin requires fresh password confirmation.
  if (
    (await rolesIncludeSuperAdmin(data.roleIds)) &&
    !(await isReauthFresh(caller.id))
  ) {
    return reauthRequiredResult();
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

  // Direct user + credential-account insert. We deliberately do NOT route
  // through `auth.api.signUpEmail` because that endpoint always issues a
  // session for the freshly-created user and the `nextCookies()` plugin
  // stamps that session token into the response cookie jar — which would
  // silently sign the calling admin OUT of their own session and IN as
  // the new user. The previous workaround (capture + restore the admin's
  // cookie value) was fragile: Better Auth promotes the cookie name to
  // `__Secure-better-auth.session_token` over HTTPS, so a hardcoded name
  // misses the actual cookie in production. Bypassing signUpEmail entirely
  // removes the whole class of session-handoff bugs — no session is ever
  // issued, so there's nothing to undo.
  //
  // The accounts row is created with `password = null`. Better Auth's
  // `auth.api.resetPassword` (invoked from /admin/setup) updates this
  // column with a real hash when the user clicks the setup-invite link.
  // Until then the user has no way to sign in via credential — exactly
  // the intended welcome-email flow.
  const createdId = randomUUID();
  try {
    await transactional(async (tx) => {
      await tx.insert(users).values({
        id: createdId,
        email: data.email,
        emailVerified: false,
        name: data.name,
        language: data.language,
        createdById: caller.id,
        isActive: true,
      });
      // Better Auth's credential provider expects:
      //   providerId = "credential", accountId = <user id>, password = hash.
      await tx.insert(accounts).values({
        userId: createdId,
        accountId: createdId,
        providerId: "credential",
        password: null,
      });
      if (data.roleIds.length > 0) {
        await tx.insert(userRoles).values(
          data.roleIds.map((roleId) => ({
            userId: createdId,
            roleId,
            assignedById: caller.id,
          })),
        );
      }
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not create user",
    };
  }

  await audit({
    actorId: caller.id,
    action: "user.create",
    targetType: "user",
    targetId: createdId,
    after: { email: data.email, roleIds: data.roleIds },
  });

  // Send the welcome / set-your-password email. Better Auth issues a
  // signed reset token and invokes the `sendResetPassword` callback in
  // `lib/auth/index.ts` which routes through our staff_setup_invite
  // template. Best-effort — admin still sees a successful create even
  // if email send fails (logged to dev console for diagnosis; ops can
  // resend via the existing "Reset password" admin action).
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    await auth.api.requestPasswordReset({
      body: {
        email: data.email,
        redirectTo: `${appUrl}/admin/login?reset=ok`,
      },
    });
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[createUser] welcome email send failed:", err);
    }
  }

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
export type UpdateUserResult =
  | { ok: true }
  | { ok: false; error: string; reauthRequired?: true };

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
    // Lockout guard: don't let the last active Super Admin lose the
    // role via a role update. We already block this for `deactivate`;
    // this closes the symmetric path. Applies to self-edits AND
    // edits-by-another (an admin removing SA from the only remaining
    // SA would brick the org just the same).
    const willStillBeSuperAdmin = await rolesIncludeSuperAdmin(data.roleIds);
    if (
      !willStillBeSuperAdmin &&
      (await productionContext.isLastActiveSuperAdmin(userId))
    ) {
      return {
        ok: false,
        error:
          "You can't remove the Super Admin role from the only active Super Admin. Grant Super Admin to another user first.",
      };
    }
    // M17: granting Super Admin in an update also requires fresh
    // password confirmation, even if the user already had it before
    // — the operation is sensitive enough either way.
    if (willStillBeSuperAdmin && !(await isReauthFresh(caller.id))) {
      return reauthRequiredResult();
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
    await transactional(async (tx) => {
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
  await transactional(async (tx) => {
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

// ── unlockUser ─────────────────────────────────────────────────────

export async function unlockUser(
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await requireSessionUser();
  if (!(await can(caller, "users.unlock", { type: "global" }, productionContext))) {
    throw new ForbiddenError();
  }

  const [target] = await db
    .select({
      id: users.id,
      email: users.email,
      lockedUntil: users.lockedUntil,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) throw new NotFoundError();

  await db
    .update(users)
    .set({ lockedUntil: null, updatedAt: new Date() })
    .where(eq(users.id, userId));

  // Also flush the Redis-side counter + lock so the user can immediately
  // attempt sign-in without the in-memory ban hanging on.
  await clearFailures(target.email);

  await audit({
    actorId: caller.id,
    action: "user.unlock",
    targetType: "user",
    targetId: userId,
    before: { lockedUntil: target.lockedUntil?.toISOString() ?? null },
  });

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

  const appUrl = getAppUrl();
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

// Roles that mark a user as "internal staff" (vs external customer).
// Anyone holding any of these is considered internal; everyone else
// (Customer-only or no-roles) is external.
const INTERNAL_ROLE_NAMES = new Set([
  "Super Admin",
  "IT Director",
  "Coordinator",
  "Technician",
]);

export async function listUsersForAdmin(opts: {
  query?: string;
  roleId?: string;
  status?: "active" | "inactive" | "all";
  audience?: "internal" | "external" | "all";
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
  if (opts.audience === "internal") {
    rows = rows.filter((u) =>
      u.roles.some((r) => INTERNAL_ROLE_NAMES.has(r.name)),
    );
  } else if (opts.audience === "external") {
    rows = rows.filter(
      (u) => !u.roles.some((r) => INTERNAL_ROLE_NAMES.has(r.name)),
    );
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
