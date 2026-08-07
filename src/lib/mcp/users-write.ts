import "server-only";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { can, type SessionUser } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { clearFailures } from "@/lib/auth/lockout";
import { db, transactional } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { roles as rolesTable, userRoles } from "@/lib/db/schema/rbac";
import { getAppUrl } from "@/lib/request";
import {
  provisionUser,
  STAFF_INVITE_DEFAULT_EXPIRY_MS,
} from "@/lib/users/provision";
import { sendCustomerSetupInvite } from "@/lib/customer/invite";
import { permissionsBeyondCaller } from "@/lib/auth/permission-diff";
import {
  getDescendants,
  permissionsForRoles,
  rolesIncludeSuperAdmin,
} from "@/app/actions/users";

// Mirrors app/actions/users.ts's mutating actions, adapted to take an
// explicit SessionUser and to resolve people/roles by EMAIL/NAME instead of
// uuid (what a chat conversation naturally uses). Every permission check and
// guard (last-active-Super-Admin protection, "can't grant beyond your own
// permissions") is copied verbatim from the source action.
//
// One deliberate difference: granting Super Admin normally requires a fresh
// interactive password re-confirmation (M17) — there's no equivalent
// "confirm your password" step over MCP, so granting Super Admin via these
// tools is refused outright with a message pointing at the admin panel.
// This is NOT a workaround of that control, it's the same control applied
// more strictly (MCP can do LESS than the UI here, never more).

type Result = { ok: true; [k: string]: unknown } | { ok: false; error: string };

async function findUserByEmail(email: string) {
  const [row] = await db
    .select({ id: users.id, createdById: users.createdById, name: users.name })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  return row ?? null;
}

async function resolveRoleIdsByName(roleNames: string[]): Promise<
  { ok: true; ids: string[] } | { ok: false; error: string }
> {
  if (roleNames.length === 0) return { ok: true, ids: [] };
  const rows = await db
    .select({ id: rolesTable.id, name: rolesTable.name })
    .from(rolesTable)
    .where(inArray(rolesTable.name, roleNames));
  const found = new Set(rows.map((r) => r.name));
  const missing = roleNames.filter((n) => !found.has(n));
  if (missing.length > 0) {
    return { ok: false, error: `Unknown role name(s): ${missing.join(", ")}` };
  }
  return { ok: true, ids: rows.map((r) => r.id) };
}

// ── create_user ──────────────────────────────────────────────────────────
// Mirrors createUser (app/actions/users.ts ~141-245).
export async function createUserViaMcp(
  user: SessionUser,
  input: { name: string; email: string; roleNames: string[]; organizationId?: string; phone?: string },
): Promise<Result> {
  if (!(await can(user, "users.create", { type: "global" }, productionContext))) {
    return { ok: false, error: "You don't have permission to create users." };
  }

  const roleRes = await resolveRoleIdsByName(input.roleNames);
  if (!roleRes.ok) return roleRes;
  const roleIds = roleRes.ids;

  if (roleIds.length > 0) {
    const requested = await permissionsForRoles(roleIds);
    const beyond = permissionsBeyondCaller(requested, user.permissions);
    if (beyond.length > 0) {
      return { ok: false, error: `You can't grant permissions you don't hold: ${beyond.join(", ")}` };
    }
  }

  if (await rolesIncludeSuperAdmin(roleIds)) {
    return {
      ok: false,
      error: "Granting Super Admin requires an interactive password confirmation — do this from the admin panel instead.",
    };
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email.trim().toLowerCase())).limit(1);
  if (existing) return { ok: false, error: "A user with that email already exists." };

  const invitedAt = new Date();
  const result = await provisionUser({
    name: input.name,
    email: input.email.trim().toLowerCase(),
    organizationId: input.organizationId,
    phone: input.phone,
    roleIds,
    createdById: user.id,
    invitedAt,
    inviteExpiresAt: new Date(invitedAt.getTime() + STAFF_INVITE_DEFAULT_EXPIRY_MS),
  });
  if (!result.ok) return result;

  await audit({
    actorId: user.id,
    action: "user.create",
    targetType: "user",
    targetId: result.userId,
    after: { email: input.email, roleIds, via: "mcp" },
  });

  if (result.isCustomer) {
    const sendResult = await sendCustomerSetupInvite({
      userId: result.userId,
      name: input.name,
      email: input.email,
      organizationId: input.organizationId ?? null,
      flow: "set",
    });
    if (!sendResult.ok) console.error("[createUserViaMcp] customer invite send failed:", sendResult.error);
  } else {
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
      await auth.api.requestPasswordReset({
        body: { email: input.email, redirectTo: `${appUrl}/admin/login?reset=ok` },
      });
    } catch (err) {
      console.error("[createUserViaMcp] welcome email send failed:", err);
    }
  }

  return { ok: true, userId: result.userId };
}

// ── update_user ──────────────────────────────────────────────────────────
// Mirrors updateUser (app/actions/users.ts ~261-367).
export async function updateUserViaMcp(
  user: SessionUser,
  targetEmail: string,
  changes: { name?: string; organizationId?: string | null; roleNames?: string[] },
): Promise<Result> {
  const target = await findUserByEmail(targetEmail);
  if (!target) return { ok: false, error: `No user found with email ${targetEmail}.` };
  if (
    !(await can(user, "users.update", { type: "user", user: { id: target.id, createdById: target.createdById } }, productionContext))
  ) {
    return { ok: false, error: "You don't have permission to update this user." };
  }

  let roleIds: string[] | undefined;
  if (changes.roleNames) {
    const roleRes = await resolveRoleIdsByName(changes.roleNames);
    if (!roleRes.ok) return roleRes;
    roleIds = roleRes.ids;

    const requested = await permissionsForRoles(roleIds);
    const beyond = permissionsBeyondCaller(requested, user.permissions);
    if (beyond.length > 0) {
      return { ok: false, error: `You can't grant permissions you don't hold: ${beyond.join(", ")}` };
    }
    const willStillBeSuperAdmin = await rolesIncludeSuperAdmin(roleIds);
    if (!willStillBeSuperAdmin && (await productionContext.isLastActiveSuperAdmin(target.id))) {
      return { ok: false, error: "You can't remove the Super Admin role from the only active Super Admin." };
    }
    if (willStillBeSuperAdmin) {
      return {
        ok: false,
        error: "Granting/keeping Super Admin requires an interactive password confirmation — do this from the admin panel instead.",
      };
    }
  }

  if (changes.name || changes.organizationId !== undefined) {
    await db
      .update(users)
      .set({
        ...(changes.name ? { name: changes.name } : {}),
        ...(changes.organizationId !== undefined ? { organizationId: changes.organizationId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, target.id));
  }

  if (roleIds) {
    await transactional(async (tx) => {
      await tx.delete(userRoles).where(eq(userRoles.userId, target.id));
      if (roleIds!.length > 0) {
        await tx.insert(userRoles).values(roleIds!.map((roleId) => ({ userId: target.id, roleId, assignedById: user.id })));
      }
    });
  }

  await audit({
    actorId: user.id,
    action: "user.update",
    targetType: "user",
    targetId: target.id,
    after: { ...changes, via: "mcp" },
  });

  return { ok: true };
}

// ── deactivate_user ────────────────────────────────────────────────────
// Mirrors deactivateUser (app/actions/users.ts ~382-492). can() itself
// blocks deactivating the last active Super Admin — no need to duplicate
// that check here, just don't bypass can().
export async function deactivateUserViaMcp(
  user: SessionUser,
  targetEmail: string,
  cascade: "move-up" | "cascade" | "reassign",
  reassignToEmail?: string,
): Promise<Result> {
  const target = await findUserByEmail(targetEmail);
  if (!target) return { ok: false, error: `No user found with email ${targetEmail}.` };
  if (
    !(await can(user, "users.deactivate", { type: "user", user: { id: target.id, createdById: target.createdById } }, productionContext))
  ) {
    return { ok: false, error: "You don't have permission to deactivate this user (this may be because they're the only active Super Admin)." };
  }

  let reassignToId: string | undefined;
  if (cascade === "reassign") {
    if (!reassignToEmail) return { ok: false, error: "Pick a user to reassign descendants to." };
    const reassign = await findUserByEmail(reassignToEmail);
    if (!reassign) return { ok: false, error: `No user found with email ${reassignToEmail}.` };
    if (reassign.id === target.id) return { ok: false, error: "Reassign target can't be the user being deactivated." };
    reassignToId = reassign.id;
  }

  const directChildren = await db.select({ id: users.id }).from(users).where(eq(users.createdById, target.id));

  let affected = 0;
  await transactional(async (tx) => {
    if (cascade === "move-up") {
      await tx.update(users).set({ createdById: target.createdById, updatedAt: new Date() }).where(eq(users.createdById, target.id));
      affected = directChildren.length;
    } else if (cascade === "reassign") {
      await tx.update(users).set({ createdById: reassignToId!, updatedAt: new Date() }).where(eq(users.createdById, target.id));
      affected = directChildren.length;
    } else {
      const descendants = await getDescendants(target.id);
      if (descendants.length > 0) {
        await tx
          .update(users)
          .set({ isActive: false, deactivatedAt: new Date(), deactivatedById: user.id, updatedAt: new Date() })
          .where(inArray(users.id, descendants.map((d) => d.id)));
      }
      affected = descendants.length;
    }
    await tx
      .update(users)
      .set({ isActive: false, deactivatedAt: new Date(), deactivatedById: user.id, updatedAt: new Date() })
      .where(eq(users.id, target.id));
  });

  await audit({
    actorId: user.id,
    action: "user.deactivate",
    targetType: "user",
    targetId: target.id,
    after: { cascade, affectedDescendants: affected, via: "mcp" },
  });

  return { ok: true, affectedDescendants: affected };
}

// ── reactivate_user ────────────────────────────────────────────────────
// Mirrors reactivateUser (app/actions/users.ts ~496-531).
export async function reactivateUserViaMcp(user: SessionUser, targetEmail: string): Promise<Result> {
  if (!(await can(user, "users.reactivate", { type: "global" }, productionContext))) {
    return { ok: false, error: "You don't have permission to reactivate users." };
  }
  const target = await findUserByEmail(targetEmail);
  if (!target) return { ok: false, error: `No user found with email ${targetEmail}.` };

  await db.update(users).set({ isActive: true, deactivatedAt: null, deactivatedById: null, updatedAt: new Date() }).where(eq(users.id, target.id));

  await audit({ actorId: user.id, action: "user.reactivate", targetType: "user", targetId: target.id, after: { via: "mcp" } });
  return { ok: true };
}

// ── unlock_user ────────────────────────────────────────────────────────
// Mirrors unlockUser (app/actions/users.ts ~535-573).
export async function unlockUserViaMcp(user: SessionUser, targetEmail: string): Promise<Result> {
  if (!(await can(user, "users.unlock", { type: "global" }, productionContext))) {
    return { ok: false, error: "You don't have permission to unlock users." };
  }
  const [target] = await db
    .select({ id: users.id, email: users.email, lockedUntil: users.lockedUntil })
    .from(users)
    .where(eq(users.email, targetEmail.trim().toLowerCase()))
    .limit(1);
  if (!target) return { ok: false, error: `No user found with email ${targetEmail}.` };

  await db.update(users).set({ lockedUntil: null, updatedAt: new Date() }).where(eq(users.id, target.id));
  await clearFailures(target.email);

  await audit({
    actorId: user.id,
    action: "user.unlock",
    targetType: "user",
    targetId: target.id,
    before: { lockedUntil: target.lockedUntil?.toISOString() ?? null },
    after: { via: "mcp" },
  });
  return { ok: true };
}

// ── reset_user_password ────────────────────────────────────────────────
// Mirrors resetUserPassword (app/actions/users.ts ~577-657).
export async function resetUserPasswordViaMcp(user: SessionUser, targetEmail: string): Promise<Result> {
  const target = await findUserByEmail(targetEmail);
  if (!target) return { ok: false, error: `No user found with email ${targetEmail}.` };
  if (
    !(await can(user, "users.reset_password", { type: "user", user: { id: target.id, createdById: target.createdById } }, productionContext))
  ) {
    return { ok: false, error: "You don't have permission to reset this user's password." };
  }

  const [u] = await db
    .select({ email: users.email, name: users.name, organizationId: users.organizationId })
    .from(users)
    .where(eq(users.id, target.id))
    .limit(1);
  if (!u) return { ok: false, error: "User not found." };

  const isCustomer = await productionContext.userHasRole(target.id, "Customer");

  if (isCustomer) {
    const sendResult = await sendCustomerSetupInvite({
      userId: target.id,
      name: u.name,
      email: u.email,
      organizationId: u.organizationId,
      flow: "reset",
    });
    if (!sendResult.ok) return { ok: false, error: sendResult.error };
  } else {
    const appUrl = getAppUrl();
    try {
      await auth.api.requestPasswordReset({ body: { email: u.email, redirectTo: `${appUrl}/admin/login` } });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Could not request reset" };
    }
    const invitedAt = new Date();
    await db
      .update(users)
      .set({ invitedAt, inviteExpiresAt: new Date(invitedAt.getTime() + STAFF_INVITE_DEFAULT_EXPIRY_MS), updatedAt: invitedAt })
      .where(eq(users.id, target.id));
  }

  await audit({ actorId: user.id, action: "user.reset_password", targetType: "user", targetId: target.id, after: { via: "mcp" } });
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
export function registerUserWriteTools(server: any, user: SessionUser): void {
  server.registerTool(
    "create_user",
    {
      title: "Create a staff or customer user",
      description:
        "Creates a new user account and sends them a setup-your-password invite email. Role names must match existing roles exactly (e.g. 'Technician', 'Customer'). Cannot grant Super Admin — that requires the admin panel." +
        CONFIRM_NOTE,
      inputSchema: {
        name: z.string().min(1),
        email: z.string().email(),
        roleNames: z.array(z.string()).default([]),
        organizationId: z.string().uuid().optional(),
        phone: z.string().optional(),
      },
    },
    async (input: { name: string; email: string; roleNames: string[]; organizationId?: string; phone?: string }) => {
      const r = await createUserViaMcp(user, input);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "update_user",
    {
      title: "Update a user",
      description: "Updates a user's name, organization, and/or roles (by email lookup). Cannot grant Super Admin." + CONFIRM_NOTE,
      inputSchema: {
        targetEmail: z.string().email(),
        name: z.string().optional(),
        organizationId: z.string().uuid().nullable().optional(),
        roleNames: z.array(z.string()).optional(),
      },
    },
    async (input: { targetEmail: string; name?: string; organizationId?: string | null; roleNames?: string[] }) => {
      const r = await updateUserViaMcp(user, input.targetEmail, {
        name: input.name,
        organizationId: input.organizationId,
        roleNames: input.roleNames,
      });
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "deactivate_user",
    {
      title: "Deactivate a user",
      description:
        "Deactivates a user (blocked automatically if they're the only active Super Admin). cascade: 'move-up' moves their direct reports up to their own manager, 'cascade' deactivates their whole reporting tree too, 'reassign' moves direct reports to another user (reassignToEmail required)." +
        CONFIRM_NOTE,
      inputSchema: {
        targetEmail: z.string().email(),
        cascade: z.enum(["move-up", "cascade", "reassign"]),
        reassignToEmail: z.string().email().optional(),
      },
    },
    async (input: { targetEmail: string; cascade: "move-up" | "cascade" | "reassign"; reassignToEmail?: string }) => {
      const r = await deactivateUserViaMcp(user, input.targetEmail, input.cascade, input.reassignToEmail);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "reactivate_user",
    {
      title: "Reactivate a user",
      description: "Reactivates a previously-deactivated user." + CONFIRM_NOTE,
      inputSchema: { targetEmail: z.string().email() },
    },
    async ({ targetEmail }: { targetEmail: string }) => {
      const r = await reactivateUserViaMcp(user, targetEmail);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "unlock_user",
    {
      title: "Unlock a user",
      description: "Clears a user's sign-in lockout after repeated failed login attempts." + CONFIRM_NOTE,
      inputSchema: { targetEmail: z.string().email() },
    },
    async ({ targetEmail }: { targetEmail: string }) => {
      const r = await unlockUserViaMcp(user, targetEmail);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "reset_user_password",
    {
      title: "Send a password reset",
      description: "Sends a user a fresh password-reset / setup-invite link. Doesn't reveal or change anything by itself." + CONFIRM_NOTE,
      inputSchema: { targetEmail: z.string().email() },
    },
    async ({ targetEmail }: { targetEmail: string }) => {
      const r = await resetUserPasswordViaMcp(user, targetEmail);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );
}
