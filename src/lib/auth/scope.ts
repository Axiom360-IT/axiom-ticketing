import { type SQL, and, eq, isNull, ne, sql } from "drizzle-orm";
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

// Always exclude soft-deleted rows AND drafts (the latter are
// in-progress submissions that haven't been confirmed yet, used
// only as a parent FK for pre-submission attachment uploads).
const ACTIVE_TICKETS_BASE = and(
  isNull(tickets.deletedAt),
  ne(tickets.status, "draft"),
)!;

/**
 * Returns the SQL WHERE condition that limits ticket queries to what this
 * user is allowed to see. Always excludes soft-deleted rows AND drafts.
 * Elevated roles get only the base filter; scoped roles get role-condition
 * AND-ed with it.
 *
 * Use in queue queries:
 *   const where = ticketsVisibilityCondition(user);
 *   const rows = db.select().from(tickets).where(where);
 */
export function ticketsVisibilityCondition(user: SessionUser): SQL {
  // Elevated roles see everything except soft-deleted + drafts
  for (const r of user.roleNames) {
    if (ELEVATED_TICKET_ROLES.has(r)) return ACTIVE_TICKETS_BASE;
  }

  // Strict Technician — only assigned tickets
  if (isStrictTechnician(user)) {
    return and(ACTIVE_TICKETS_BASE, eq(tickets.assignedToId, user.id))!;
  }

  // Strict Customer — only own tickets. Linking guest-submitted tickets
  // by email is added in M9.
  if (isStrictCustomer(user)) {
    return and(ACTIVE_TICKETS_BASE, eq(tickets.customerId, user.id))!;
  }

  // Unknown / no role → no access
  return sql`false`;
}
