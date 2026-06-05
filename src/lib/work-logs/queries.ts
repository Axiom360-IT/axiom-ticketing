import { and, desc, eq, gte, lte, ne, or, type SQL, sql } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/can";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { organizations } from "@/lib/db/schema/organizations";
import { ticketAssignees } from "@/lib/db/schema/ticket-assignees";
import { tickets } from "@/lib/db/schema/tickets";
import { workLogs } from "@/lib/db/schema/work-logs";

// ── Timesheet (global Work Log) reads ─────────────────────────────────
//
// Read-only queries that back the /admin/work-log timesheet. Mutations
// (add / edit / delete) live in `src/app/actions/work-logs.ts`. The
// per-ticket card uses `listWorkLogsForTicket` from that same file — this
// module is purely the cross-ticket view.
// ──────────────────────────────────────────────────────────────────────

export type WorkLogFilters = {
  /** Honoured only for callers with `worklog.view_all`; everyone else is
   *  hard-scoped to their own entries regardless of this value. */
  technicianId?: string;
  organizationId?: string;
  serviceType?: string;
  billable?: string;
  /** Inclusive YYYY-MM-DD bounds on the entry's createdAt (UTC). */
  from?: string;
  to?: string;
};

export type WorkLogRow = {
  id: string;
  description: string;
  minutes: number;
  serviceType: string;
  createdAt: Date;
  technicianId: string | null;
  technicianName: string | null;
  ticketId: string;
  ticketNumber: string;
  ticketSubject: string;
  /** Current primary assignee — used to decide whether the viewer may still
   *  edit/delete their entry (they can't once the ticket is reassigned away). */
  ticketAssignedToId: string | null;
  organizationName: string | null;
  billable: string | null;
};

function buildConditions(user: SessionUser, filters: WorkLogFilters): SQL[] {
  const canViewAll = user.permissions.has("worklog.view_all");
  const conditions: SQL[] = [];

  // Visibility scope: without view_all you ONLY ever see your own entries.
  // With it, an optional technician filter narrows the full set.
  if (!canViewAll) {
    conditions.push(eq(workLogs.technicianId, user.id));
  } else if (filters.technicianId) {
    conditions.push(eq(workLogs.technicianId, filters.technicianId));
  }

  if (filters.organizationId) {
    conditions.push(eq(tickets.organizationId, filters.organizationId));
  }
  if (filters.serviceType === "onsite" || filters.serviceType === "remote") {
    conditions.push(eq(workLogs.serviceType, filters.serviceType));
  }
  if (filters.billable) {
    conditions.push(eq(tickets.billable, filters.billable));
  }
  if (filters.from) {
    const d = new Date(`${filters.from}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) conditions.push(gte(workLogs.createdAt, d));
  }
  if (filters.to) {
    const d = new Date(`${filters.to}T23:59:59.999Z`);
    if (!Number.isNaN(d.getTime())) conditions.push(lte(workLogs.createdAt, d));
  }
  return conditions;
}

/** A page of work-log entries (newest first) plus the summed minutes across
 *  ALL matching rows (not just the page) for the running total. */
export async function listWorkLogs(
  user: SessionUser,
  filters: WorkLogFilters,
  { limit, offset }: { limit: number; offset: number },
): Promise<{ rows: WorkLogRow[]; totalMinutes: number; canViewAll: boolean }> {
  const canViewAll = user.permissions.has("worklog.view_all");
  const conditions = buildConditions(user, filters);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: workLogs.id,
      description: workLogs.description,
      minutes: workLogs.minutes,
      serviceType: workLogs.serviceType,
      createdAt: workLogs.createdAt,
      technicianId: workLogs.technicianId,
      // Live name, falling back to the snapshot so a removed/deleted
      // technician's entries stay attributable (req 4.6).
      technicianName: sql<
        string | null
      >`coalesce(${users.name}, ${workLogs.technicianName})`,
      ticketId: workLogs.ticketId,
      ticketNumber: tickets.ticketNumber,
      ticketSubject: tickets.subject,
      ticketAssignedToId: tickets.assignedToId,
      organizationName: organizations.name,
      billable: tickets.billable,
    })
    .from(workLogs)
    .innerJoin(tickets, eq(workLogs.ticketId, tickets.id))
    .leftJoin(users, eq(workLogs.technicianId, users.id))
    .leftJoin(organizations, eq(tickets.organizationId, organizations.id))
    .where(where)
    .orderBy(desc(workLogs.createdAt))
    .limit(limit)
    .offset(offset);

  const [agg] = await db
    .select({
      total: sql<number>`coalesce(sum(${workLogs.minutes}), 0)::int`,
    })
    .from(workLogs)
    .innerJoin(tickets, eq(workLogs.ticketId, tickets.id))
    .where(where);

  return { rows, totalMinutes: agg?.total ?? 0, canViewAll };
}

/** Tickets the caller can log time against from the timesheet "Add time"
 *  picker: tickets assigned to them or where they collaborate, that aren't
 *  closed. The add action re-checks `tickets.update`, so this is purely a
 *  convenience shortlist. */
export async function listLoggableTickets(
  userId: string,
): Promise<{ id: string; ticketNumber: string; subject: string }[]> {
  const rows = await db
    .selectDistinct({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      updatedAt: tickets.updatedAt,
    })
    .from(tickets)
    .leftJoin(ticketAssignees, eq(ticketAssignees.ticketId, tickets.id))
    .where(
      and(
        ne(tickets.status, "closed"),
        or(
          eq(tickets.assignedToId, userId),
          eq(ticketAssignees.userId, userId),
        ),
      ),
    )
    .orderBy(desc(tickets.updatedAt))
    .limit(100);

  return rows.map(({ id, ticketNumber, subject }) => ({
    id,
    ticketNumber,
    subject,
  }));
}

/** Ticket ids the user currently collaborates on (additional assignee). Used
 *  to decide which of their own timesheet entries they may still edit. */
export async function listUserCollaboratorTicketIds(
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ ticketId: ticketAssignees.ticketId })
    .from(ticketAssignees)
    .where(eq(ticketAssignees.userId, userId));
  return rows.map((r) => r.ticketId);
}

/** Organizations for the timesheet filter dropdown. */
export async function listOrganizationsForFilter(): Promise<
  { id: string; name: string }[]
> {
  return db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .orderBy(organizations.name);
}
