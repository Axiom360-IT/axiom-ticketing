import { type SQL, and, eq, isNull, sql } from "drizzle-orm";
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

const NOT_DELETED = isNull(tickets.deletedAt);

/**
 * Returns the SQL WHERE condition that limits ticket queries to what this
 * user is allowed to see. Always excludes soft-deleted rows (`deletedAt`
 * is set by `deleteTicket`). Elevated roles get only the soft-delete
 * filter; scoped roles get role-condition AND-ed with it.
 *
 * Use in queue queries:
 *   const where = ticketsVisibilityCondition(user);
 *   const rows = db.select().from(tickets).where(where);
 */
export function ticketsVisibilityCondition(user: SessionUser): SQL {
  // Elevated roles see everything except soft-deleted
  for (const r of user.roleNames) {
    if (ELEVATED_TICKET_ROLES.has(r)) return NOT_DELETED;
  }

  // Strict Technician — only assigned tickets
  if (isStrictTechnician(user)) {
    return and(NOT_DELETED, eq(tickets.assignedToId, user.id))!;
  }

  // Strict Customer — only own tickets. Linking guest-submitted tickets
  // by email is added in M9.
  if (isStrictCustomer(user)) {
    return and(NOT_DELETED, eq(tickets.customerId, user.id))!;
  }

  // Unknown / no role → no access
  return sql`false`;
}
