import { type SQL, and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { tickets } from "../db/schema/tickets";
import { ticketAssignees } from "../db/schema/ticket-assignees";
import { workLogs } from "../db/schema/work-logs";
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

  // Strict Technician — tickets assigned to them, OR where they are an
  // additional collaborator (Meeting-2, CR-11), OR which they've logged work
  // on (read-only carry-over: they keep sight of tickets they worked on even
  // after the ticket is reassigned away from them).
  if (isStrictTechnician(user)) {
    return and(
      ACTIVE_TICKETS_BASE,
      or(
        eq(tickets.assignedToId, user.id),
        sql`EXISTS (SELECT 1 FROM ${ticketAssignees} WHERE ${ticketAssignees.ticketId} = ${tickets.id} AND ${ticketAssignees.userId} = ${user.id})`,
        sql`EXISTS (SELECT 1 FROM ${workLogs} WHERE ${workLogs.ticketId} = ${tickets.id} AND ${workLogs.technicianId} = ${user.id})`,
      ),
    )!;
  }

  // Strict Customer — only own tickets. Linking guest-submitted tickets
  // by email is added in M9.
  if (isStrictCustomer(user)) {
    return and(ACTIVE_TICKETS_BASE, eq(tickets.customerId, user.id))!;
  }

  // Unknown / no role → no access
  return sql`false`;
}
