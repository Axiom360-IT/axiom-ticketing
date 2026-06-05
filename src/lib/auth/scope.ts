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
 * For a strict technician this defaults to their ACTIVE list — tickets they
 * currently own (primary assignee) or co-own (a merge co-assignee). A ticket
 * reassigned away from them leaves this set immediately (req 3.1/3.3). Pass
 * `{ includeWorkedOn: true }` to additionally surface tickets they've logged
 * work on but no longer own — a read-only carry-over used by search/history so
 * their worklog stays reachable (req 3.4), NOT by the active queue.
 *
 * Use in queue queries:
 *   const where = ticketsVisibilityCondition(user);
 *   const rows = db.select().from(tickets).where(where);
 */
export function ticketsVisibilityCondition(
  user: SessionUser,
  opts?: { includeWorkedOn?: boolean },
): SQL {
  // Elevated roles see everything except soft-deleted + drafts
  for (const r of user.roleNames) {
    if (ELEVATED_TICKET_ROLES.has(r)) return ACTIVE_TICKETS_BASE;
  }

  // Strict Technician — their ACTIVE list is tickets currently assigned to
  // them OR where they are a merge co-assignee (the single sanctioned
  // two-technician case, req 4.4). The worklog carry-over leg is added only
  // when `includeWorkedOn` is set, so a reassigned-away ticket drops out of the
  // active queue (req 3.3) yet stays findable in history (req 3.4).
  if (isStrictTechnician(user)) {
    const legs: SQL[] = [
      eq(tickets.assignedToId, user.id),
      sql`EXISTS (SELECT 1 FROM ${ticketAssignees} WHERE ${ticketAssignees.ticketId} = ${tickets.id} AND ${ticketAssignees.userId} = ${user.id})`,
    ];
    if (opts?.includeWorkedOn) {
      legs.push(
        sql`EXISTS (SELECT 1 FROM ${workLogs} WHERE ${workLogs.ticketId} = ${tickets.id} AND ${workLogs.technicianId} = ${user.id})`,
      );
    }
    return and(ACTIVE_TICKETS_BASE, or(...legs))!;
  }

  // Strict Customer — only own tickets. Linking guest-submitted tickets
  // by email is added in M9.
  if (isStrictCustomer(user)) {
    return and(ACTIVE_TICKETS_BASE, eq(tickets.customerId, user.id))!;
  }

  // Unknown / no role → no access
  return sql`false`;
}
