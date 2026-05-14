import { eq } from "drizzle-orm";
import { db } from "./client";
import { users } from "./schema/auth";
import { roles, userRoles } from "./schema/rbac";
import { claimTicketsForCustomer } from "../customer/reconcile";

/**
 * One-shot, idempotent backfill: for every active user holding the Customer
 * role, claim every legacy `tickets.customer_id IS NULL` row whose
 * `customer_email` matches the user's email. Re-runs are no-ops once a row
 * is bound. Run via `pnpm db:backfill-customers`.
 */
async function main(): Promise<void> {
  const [customerRole] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, "Customer"))
    .limit(1);
  if (!customerRole) {
    throw new Error("Customer role missing — run pnpm db:seed first.");
  }

  const customers = await db
    .select({
      id: users.id,
      email: users.email,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(eq(userRoles.roleId, customerRole.id));

  let total = 0;
  for (const c of customers) {
    if (!c.email) continue;
    const { count } = await claimTicketsForCustomer(c.id, c.email);
    if (count > 0) {
      console.log(`  ${c.email}: claimed ${count}`);
      total += count;
    }
  }
  console.log(`Backfill complete. ${total} ticket(s) linked.`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
