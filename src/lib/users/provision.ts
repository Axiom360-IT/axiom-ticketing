import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, transactional } from "@/lib/db/client";
import { accounts, users } from "@/lib/db/schema/auth";
import { roles, userRoles } from "@/lib/db/schema/rbac";
import { claimTicketsForCustomer } from "@/lib/customer/reconcile";

const CUSTOMER_ROLE_NAME = "Customer";

// Mirrors `emailAndPassword.resetPasswordTokenExpiresIn` in lib/auth/index.ts
// (staff invites use Better Auth's own token; customer invites use their own
// — see lib/tokens.ts). This constant only feeds `inviteExpiresAt` for
// DISPLAY on the admin Users list, so it must be kept in sync with whatever
// Better Auth is actually configured with.
export const STAFF_INVITE_DEFAULT_EXPIRY_MS = 60 * 60 * 24 * 1000; // 24 hours

export type ProvisionUserInput = {
  name: string;
  email: string;
  organizationId?: string | null;
  phone?: string | null;
  roleIds: string[];
  createdById: string;
  invitedAt: Date;
  inviteExpiresAt: Date;
};

export type ProvisionUserResult =
  | { ok: true; userId: string; isCustomer: boolean }
  | { ok: false; error: string };

async function rolesIncludeCustomer(roleIds: string[]): Promise<boolean> {
  if (roleIds.length === 0) return false;
  const rows = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(inArray(roles.id, roleIds), eq(roles.name, CUSTOMER_ROLE_NAME)))
    .limit(1);
  return rows.length > 0;
}

/** The Customer role's id, or null if it's missing (should never happen —
 *  it's seeded — but callers decide how to react rather than this
 *  function throwing). */
export async function loadCustomerRoleId(): Promise<string | null> {
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, CUSTOMER_ROLE_NAME))
    .limit(1);
  return role?.id ?? null;
}

/**
 * The one place that inserts a `users` + `accounts` row on someone else's
 * behalf (admin-created staff, admin/bulk-created customers). Deliberately
 * bypasses Better Auth's `signUpEmail` — see the long comment this replaced
 * in `app/actions/users.ts` `createUser` for why (session-handoff risk).
 *
 * Does NOT send the invite email — callers own that, because the mechanism
 * differs by audience (staff: Better Auth's `requestPasswordReset`; customer:
 * the dedicated invite token from Phase 4). This function only guarantees the
 * row, the roles, and — for a Customer-role grant — that any prior guest
 * tickets under this email get claimed (normally a Better Auth
 * `databaseHooks.user.create.after` side effect, which direct inserts bypass).
 */
export async function provisionUser(
  input: ProvisionUserInput,
): Promise<ProvisionUserResult> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);
  if (existing) {
    return { ok: false, error: "A user with that email already exists." };
  }

  const isCustomer = await rolesIncludeCustomer(input.roleIds);

  const createdId = randomUUID();
  try {
    await transactional(async (tx) => {
      await tx.insert(users).values({
        id: createdId,
        email: input.email,
        // Admin trust: whoever provisions this account vouches for the
        // email (out-of-band verification, or a bulk-import review pass).
        // Combined with the invite flow requiring a click on that exact
        // email, this stands in for a verification round-trip.
        emailVerified: true,
        name: input.name,
        phone: input.phone && input.phone.length > 0 ? input.phone : null,
        organizationId: input.organizationId ?? null,
        createdById: input.createdById,
        isActive: true,
        // Row + accounts + roles all land in this one transaction, so this
        // caller's users are immediately fully set up — unlike a bulk-import
        // stub (createCustomerImportStubs), which leaves this null until
        // finishCustomerProvisioning completes it later.
        provisionedAt: new Date(),
        invitedAt: input.invitedAt,
        inviteExpiresAt: input.inviteExpiresAt,
      });
      await tx.insert(accounts).values({
        userId: createdId,
        accountId: createdId,
        providerId: "credential",
        password: null,
      });
      if (input.roleIds.length > 0) {
        await tx.insert(userRoles).values(
          input.roleIds.map((roleId) => ({
            userId: createdId,
            roleId,
            assignedById: input.createdById,
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

  if (isCustomer) {
    await claimTicketsForCustomer(createdId, input.email);
  }

  return { ok: true, userId: createdId, isCustomer };
}

export type CustomerImportStubInput = {
  name: string;
  email: string;
  phone: string;
  organizationId: string;
};

/**
 * Bulk-import's synchronous half: creates the bare `users` row for every
 * given row in ONE statement, immediately — so a bulk-imported customer is
 * visible on the admin Users list (as "provisioning") the instant the
 * import is committed, instead of only once the async job gets to them. No
 * `accounts` row, no roles, `provisionedAt`/`invitedAt`/`inviteExpiresAt`
 * all left null — finishCustomerProvisioning does the rest later.
 *
 * Relies on `users.email`'s real unique constraint (not a pre-check SELECT)
 * for race safety: `onConflictDoNothing` means a row that loses a genuine
 * concurrent-duplicate race is simply absent from the returned list, rather
 * than aborting the whole batch. Callers detect a skipped row by its email
 * missing from the result.
 */
export async function createCustomerImportStubs(
  rows: CustomerImportStubInput[],
  createdById: string,
): Promise<{ userId: string; email: string }[]> {
  if (rows.length === 0) return [];
  return db
    .insert(users)
    .values(
      rows.map((row) => ({
        id: randomUUID(),
        email: row.email,
        emailVerified: true,
        name: row.name,
        phone: row.phone.length > 0 ? row.phone : null,
        organizationId: row.organizationId,
        createdById,
        isActive: true,
      })),
    )
    .onConflictDoNothing({ target: users.email })
    .returning({ userId: users.id, email: users.email });
}

export type FinishCustomerProvisioningInput = {
  userId: string;
  email: string;
  roleIds: string[];
  createdById: string;
};

export type FinishCustomerProvisioningResult =
  | { ok: true; isCustomer: boolean }
  | { ok: false; error: string };

/**
 * Bulk-import's async half — completes a stub row created by
 * createCustomerImportStubs: grants roles, creates its `accounts`
 * credential row, and marks `provisionedAt`. Mirrors provisionUser's own
 * transaction shape exactly, just against an already-existing row instead
 * of inserting a new one. Ticket-claiming stays a separate post-transaction
 * call, matching provisionUser's existing placement.
 */
export async function finishCustomerProvisioning(
  input: FinishCustomerProvisioningInput,
): Promise<FinishCustomerProvisioningResult> {
  const isCustomer = await rolesIncludeCustomer(input.roleIds);

  try {
    await transactional(async (tx) => {
      await tx.insert(accounts).values({
        userId: input.userId,
        accountId: input.userId,
        providerId: "credential",
        password: null,
      });
      if (input.roleIds.length > 0) {
        await tx.insert(userRoles).values(
          input.roleIds.map((roleId) => ({
            userId: input.userId,
            roleId,
            assignedById: input.createdById,
          })),
        );
      }
      await tx
        .update(users)
        .set({ provisionedAt: new Date() })
        .where(eq(users.id, input.userId));
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not finish provisioning",
    };
  }

  if (isCustomer) {
    await claimTicketsForCustomer(input.userId, input.email);
  }

  return { ok: true, isCustomer };
}
