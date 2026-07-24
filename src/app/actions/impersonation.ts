"use server";

import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import {
  IMPERSONATION_COOKIE,
  signImpersonationToken,
  verifyImpersonationToken,
} from "@/lib/auth/impersonation";
import { requireSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { roles, userRoles } from "@/lib/db/schema/rbac";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

const COOKIE_MAX_AGE_SECONDS = 60 * 60; // 1h

// Staff roles reach the /admin console; a user whose only role is Customer
// belongs in the /portal experience. When impersonating, we send the admin to
// the impersonated user's OWN home so they see what that user actually sees.
const STAFF_ROLE_NAMES = ["Super Admin", "IT Director", "Coordinator", "Technician"];

/**
 * Begin impersonating `targetUserId`. Gated by `users.impersonate` with a
 * user-typed target so `can()` can apply the "no Super Admins" check
 * from ARCHITECTURE §7.
 *
 * Stacking is disallowed: if an impersonation is already active, the
 * caller must end it before starting another. Otherwise auditing gets
 * tangled (the "real admin" id stops being unambiguous).
 */
export async function startImpersonation(
  targetUserId: string,
): Promise<{ ok: true; redirectTo: string } | { ok: false; error: string }> {
  // Before any cookie is set this returns the actual signed-in admin.
  const caller = await requireSessionUser();
  if (caller.isImpersonating) {
    return { ok: false, error: "End the current impersonation first." };
  }

  const [target] = await db
    .select({
      id: users.id,
      createdById: users.createdById,
      name: users.name,
    })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  if (!target) throw new NotFoundError();

  if (
    !(await can(
      caller,
      "users.impersonate",
      {
        type: "user",
        user: { id: target.id, createdById: target.createdById },
      },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  const token = signImpersonationToken(caller.id, target.id);
  const cookieStore = await cookies();
  cookieStore.set(IMPERSONATION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  await audit({
    actorId: caller.id,
    impersonatorId: caller.id,
    action: "user.impersonation.start",
    targetType: "user",
    targetId: target.id,
    after: { targetName: target.name },
  });

  // Send the admin to the impersonated user's OWN home: a customer's portal
  // vs. the staff console. Otherwise impersonating a customer would drop the
  // admin into /admin with the customer's (empty) permissions — an empty,
  // confusing shell rather than the customer's real experience.
  const targetRoleRows = await db
    .select({ name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, target.id));
  const roleNames = new Set(targetRoleRows.map((r) => r.name));
  const isCustomerOnly =
    roleNames.has("Customer") &&
    !STAFF_ROLE_NAMES.some((r) => roleNames.has(r));
  const redirectTo = isCustomerOnly ? "/portal" : "/admin";

  revalidatePath("/admin");
  revalidatePath("/portal");
  return { ok: true, redirectTo };
}

export async function endImpersonation(): Promise<{ ok: true }> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(IMPERSONATION_COOKIE)?.value;
  cookieStore.delete(IMPERSONATION_COOKIE);

  if (raw) {
    const verified = verifyImpersonationToken(raw);
    if (verified) {
      // Confirm the actual signed-in admin matches the token before
      // attributing the audit entry to them.
      const session = await auth.api.getSession({ headers: await headers() });
      if (session?.user?.id === verified.impersonatorId) {
        await audit({
          actorId: verified.impersonatorId,
          impersonatorId: verified.impersonatorId,
          action: "user.impersonation.end",
          targetType: "user",
          targetId: verified.targetId,
        });
      }
    }
  }

  revalidatePath("/admin");
  return { ok: true };
}
