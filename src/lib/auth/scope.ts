import { type SQL, eq, sql } from "drizzle-orm";
import { tickets } from "../db/schema/tickets";
import {
  type SessionUser,
  isStrictCustomer,
  isStrictTechnician,
} from "./can";

const ELEVATED_TICKET_ROLES = new Set([
  "Super Admin",
  "IT Director",
  "Coordinator",
]);

/**
 * Returns the SQL WHERE condition that limits ticket queries to what this
 * user is allowed to see. Returns `undefined` for users who can see all tickets
 * (Super Admin / IT Director / Coordinator) and a falsy condition for users
 * with no access at all.
 *
 * Use in queue queries:
 *   const where = ticketsVisibilityCondition(user);
 *   const rows = where ? db.select().from(tickets).where(where) : db.select().from(tickets);
 */
export function ticketsVisibilityCondition(
  user: SessionUser,
): SQL | undefined {
  // Elevated roles see everything
  for (const r of user.roleNames) {
    if (ELEVATED_TICKET_ROLES.has(r)) return undefined;
  }

  // Strict Technician — only assigned tickets
  if (isStrictTechnician(user)) {
    return eq(tickets.assignedToId, user.id);
  }

  // Strict Customer — only own tickets. Linking guest-submitted tickets
  // by email is added in M9.
  if (isStrictCustomer(user)) {
    return eq(tickets.customerId, user.id);
  }

  // Unknown / no role → no access
  return sql`false`;
}
