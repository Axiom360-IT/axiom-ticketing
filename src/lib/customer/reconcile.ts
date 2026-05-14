import { and, eq, isNull, sql } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema/tickets";
import { roles, userRoles } from "@/lib/db/schema/rbac";

const CUSTOMER_ROLE_NAME = "Customer";

/**
 * Atomically claim every legacy/anonymous ticket whose `customer_email` matches
 * the verified email of a freshly-created customer account. Idempotent: re-runs
 * filter on `customer_id IS NULL`, so concurrent calls and post-login defensive
 * runs are no-ops once a row is bound.
 *
 * Trust model: the caller must have verified email ownership (magic-link
 * redemption or password email-verification click). Same trust level the
 * inbound-email pipeline already grants the From address.
 */
export async function claimTicketsForCustomer(
  userId: string,
  email: string,
): Promise<{ count: number }> {
  const result = await db
    .update(tickets)
    .set({ customerId: userId, updatedAt: new Date() })
    .where(
      and(
        isNull(tickets.customerId),
        sql`lower(${tickets.customerEmail}) = lower(${email})`,
      ),
    )
    .returning({ id: tickets.id });

  if (result.length > 0) {
    await audit({
      actorId: userId,
      action: "customer.claim_tickets",
      targetType: "user",
      targetId: userId,
      after: { count: result.length },
    });
  }

  return { count: result.length };
}

/**
 * Assigns the seeded `Customer` role to a newly-created user. Called from
 * Better Auth's `databaseHooks.user.create.after`. Idempotent — a duplicate
 * insert hits the (userId, roleId) primary key and is swallowed.
 */
export async function assignCustomerRole(userId: string): Promise<void> {
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, CUSTOMER_ROLE_NAME))
    .limit(1);
  if (!role) {
    throw new Error(
      `Customer role missing — run pnpm db:seed before customer sign-ups`,
    );
  }
  await db
    .insert(userRoles)
    .values({ userId, roleId: role.id })
    .onConflictDoNothing();
}
