import type { Permission } from "./permissions";

// ── Public types ──────────────────────────────────────────────────────

export type Target =
  | { type: "global" }
  | {
      type: "ticket";
      ticket: {
        id: string;
        assignedToId: string | null;
        customerId: string | null;
      };
    }
  | {
      type: "user";
      user: { id: string; createdById: string | null };
    }
  | {
      type: "procurement";
      request: { id: string; requestedById: string | null };
    };

export type SessionUser = {
  id: string;
  permissions: Set<Permission>;
  roleNames: Set<string>;
  isImpersonating: boolean;
};

// Dependencies that hit the DB. Injected for testability — tests pass mocks;
// production code uses `productionContext` from `./can-context`.
export type CanContext = {
  isDescendantOf: (targetId: string, actorId: string) => Promise<boolean>;
  userHasRole: (userId: string, roleName: string) => Promise<boolean>;
  isLastActiveSuperAdmin: (userId: string) => Promise<boolean>;
};

// ── Role helpers (sync, no DB) ─────────────────────────────────────────

const ELEVATED_ROLES = new Set([
  "Super Admin",
  "IT Director",
  "Coordinator",
]);

/** A user whose ONLY role is Technician (no Coordinator/Admin/IT Director). */
export function isStrictTechnician(user: SessionUser): boolean {
  if (!user.roleNames.has("Technician")) return false;
  for (const r of user.roleNames) {
    if (ELEVATED_ROLES.has(r)) return false;
  }
  return true;
}

/** A user whose ONLY role is Customer. */
export function isStrictCustomer(user: SessionUser): boolean {
  return user.roleNames.has("Customer") && user.roleNames.size === 1;
}

/** A user with no Coordinator/Super Admin role — used for procurement scope. */
export function isStrictRequester(user: SessionUser): boolean {
  return (
    !user.roleNames.has("Coordinator") && !user.roleNames.has("Super Admin")
  );
}

// ── The single permission gate ────────────────────────────────────────

const BLOCKED_DURING_IMPERSONATION: ReadonlySet<Permission> = new Set([
  "settings.update",
  "roles.create",
  "roles.update",
  "roles.delete",
  "users.create",
  "users.deactivate",
  "users.impersonate",
]);

/**
 * THE single authorization gate. Every Server Action and Route Handler that
 * does anything privileged must call this. No exceptions.
 *
 * Returns `true` only when ALL of:
 *   1. user holds at least one role
 *   2. user holds the requested permission
 *   3. impersonation does not block the action (if impersonating)
 *   4. action-specific scope check (ticket assignment, user hierarchy, etc.)
 *      passes
 *
 * `ctx` defaults are NOT provided here — production callers must pass
 * `productionContext` from `./can-context`. Tests pass mock contexts.
 * (This file intentionally does not import the DB so unit tests don't
 * require DATABASE_URL.)
 */
export async function can(
  user: SessionUser,
  action: Permission,
  target: Target = { type: "global" },
  ctx?: CanContext,
): Promise<boolean> {
  // 1. Zero roles = no access (defensive — schema permits but app blocks)
  if (user.roleNames.size === 0) return false;

  // 2. Must hold the permission
  if (!user.permissions.has(action)) return false;

  // 3. Impersonator restrictions
  if (user.isImpersonating && BLOCKED_DURING_IMPERSONATION.has(action)) {
    return false;
  }

  // 4. Action-specific scope checks
  switch (action) {
    case "tickets.view":
    case "tickets.update":
    case "tickets.reply":
    case "tickets.internal_note":
    case "tickets.resolve":
    case "tickets.escalate":
    case "tickets.reopen":
      if (target.type !== "ticket") return false;
      if (isStrictTechnician(user)) {
        return target.ticket.assignedToId === user.id;
      }
      if (isStrictCustomer(user)) {
        return target.ticket.customerId === user.id;
      }
      return true;

    case "users.update":
    case "users.deactivate":
    case "users.reset_password":
      if (target.type !== "user") return false;
      // Self-action gating differs by action:
      //   - deactivate / reset_password: blocked outright. These are the
      //     two ways a user can lock themselves out, and "I'd never do
      //     that" is exactly when they do.
      //   - update: allowed. Editing your own name/language/roles is
      //     normal. The "can't grant what you don't have" rule still
      //     applies on the role-assignment side, so a non-Super-Admin
      //     can't sneak themselves an elevated role this way.
      if (action !== "users.update" && target.user.id === user.id) {
        return false;
      }
      if (action === "users.deactivate") {
        if (!ctx) throw new Error("CanContext required for users.deactivate");
        if (await ctx.isLastActiveSuperAdmin(target.user.id)) return false;
      }
      // Self-update bypasses the hierarchy check below — you always
      // have authority over your own row.
      if (action === "users.update" && target.user.id === user.id) {
        return true;
      }
      // Super Admin bypasses the hierarchy gate. The spec calls Super
      // Admin "all permissions across all modules"; without this, a
      // seeded Super Admin can't manage seeded peers because nobody
      // has `createdById` pointing at them. Keeps the descendant rule
      // for non-Super-Admin grantees who must respect the hierarchy.
      if (user.roleNames.has("Super Admin")) return true;
      if (!ctx) throw new Error("CanContext required for user-scope actions");
      return await ctx.isDescendantOf(target.user.id, user.id);

    case "users.impersonate": {
      if (target.type !== "user") return false;
      if (!ctx) throw new Error("CanContext required for users.impersonate");
      const targetIsSuperAdmin = await ctx.userHasRole(
        target.user.id,
        "Super Admin",
      );
      if (targetIsSuperAdmin) return false;
      return true;
    }

    case "procurement.update":
      if (target.type !== "procurement") return false;
      if (isStrictRequester(user)) {
        return target.request.requestedById === user.id;
      }
      return true;

    default:
      return true;
  }
}
