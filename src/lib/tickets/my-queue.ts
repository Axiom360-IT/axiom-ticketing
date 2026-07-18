import { and, count, desc, eq, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { messages } from "@/lib/db/schema/messages";
import { organizations } from "@/lib/db/schema/organizations";
import { tickets } from "@/lib/db/schema/tickets";

// ── "My Queue" — the viewer's personal work surface on the dashboard ──────
//
// Backs the role-aware panel at the top of the admin landing page. Everything
// here is scoped to the signed-in user's OWN in-flight tickets, so a strict
// Technician's dashboard finally answers "what needs me right now" instead of
// showing the same global counts as a Super Admin.
//
// Scope = the viewer's PRIMARY assignment (tickets.assigned_to_id). Primary
// assignee is the canonical "my tickets" owner per the schema; merge
// co-assignees (ticket_assignees) grant *visibility* but aren't queue
// membership. Primary-only also lines the counts up with the tickets list's
// `?assignee=<id>` filter, which keys off the same column (the list's row set
// can still differ — its default "active" view also shows your resolved tickets).

export type MyQueueItem = {
  id: string;
  ticketNumber: string;
  subject: string;
  priority: string;
  status: string;
  isEscalated: boolean;
  slaBreachedAt: Date | null;
  slaWarning80At: Date | null;
  resolutionDueAt: Date | null;
  organizationName: string | null;
  awaitingReply: boolean;
};

export type MyQueue = {
  counts: {
    assigned: number;
    awaiting: number;
    atRisk: number;
    escalated: number;
  };
  items: MyQueueItem[];
};

const MY_QUEUE_LIMIT = 5;

/** The viewer's in-flight primary assignments (excludes resolved/closed/draft
 * and soft-deleted). Reused by both the counts and the top-N list so they can
 * never drift. */
function inFlightMine(userId: string) {
  return and(
    eq(tickets.assignedToId, userId),
    notInArray(tickets.status, ["resolved", "closed", "draft"]),
    isNull(tickets.deletedAt),
  );
}

export async function loadMyQueue(userId: string): Promise<MyQueue> {
  // "Awaiting my reply" = the latest CONVERSATIONAL turn on the ticket was the
  // customer's (the ball is in our court). We look only at customer/agent
  // messages: internal notes, inbound held for moderation, and 'system' rows
  // (e.g. a merge announcement) are all excluded so none can false-flip it.
  const latestVisibleAuthor = sql<string | null>`(
    select m.author_type from ${messages} m
    where m.ticket_id = "tickets"."id"
      and m.is_internal_note = false
      and m.moderation_status = 'approved'
      and m.author_type in ('customer', 'agent')
    order by m.created_at desc
    limit 1
  )`;

  const where = inFlightMine(userId);

  const [countsRows, items] = await Promise.all([
    db
      .select({
        assigned: count(),
        // bigint from `count(... ) filter` arrives as a string over the driver;
        // `.mapWith(Number)` makes the declared number type honest at runtime.
        escalated: sql<number>`count(*) filter (where ${tickets.isEscalated})`.mapWith(Number),
        atRisk: sql<number>`count(*) filter (where ${tickets.slaBreachedAt} is not null or ${tickets.slaWarning80At} is not null)`.mapWith(Number),
        awaiting: sql<number>`count(*) filter (where (${latestVisibleAuthor}) = 'customer')`.mapWith(Number),
      })
      .from(tickets)
      .where(where),
    db
      .select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        subject: tickets.subject,
        priority: tickets.priority,
        status: tickets.status,
        isEscalated: tickets.isEscalated,
        slaBreachedAt: tickets.slaBreachedAt,
        slaWarning80At: tickets.slaWarning80At,
        resolutionDueAt: tickets.resolutionDueAt,
        organizationName: organizations.name,
        // 1/0 rather than a boolean so the value survives the driver
        // unambiguously regardless of how pg booleans are serialized.
        awaitingReply: sql<number>`case when (${latestVisibleAuthor}) = 'customer' then 1 else 0 end`,
      })
      .from(tickets)
      .leftJoin(organizations, eq(organizations.id, tickets.organizationId))
      .where(where)
      // Urgency: breached first, then the soonest resolution deadline
      // (NULLS LAST keeps deadline-less tickets below), then escalated, then
      // oldest — so the most-on-fire ticket is always row one.
      .orderBy(
        sql`${tickets.slaBreachedAt} is not null desc`,
        sql`${tickets.resolutionDueAt} asc nulls last`,
        desc(tickets.isEscalated),
        tickets.createdAt,
      )
      .limit(MY_QUEUE_LIMIT),
  ]);

  const c = countsRows[0];
  return {
    counts: {
      assigned: Number(c?.assigned ?? 0),
      awaiting: Number(c?.awaiting ?? 0),
      atRisk: Number(c?.atRisk ?? 0),
      escalated: Number(c?.escalated ?? 0),
    },
    items: items.map((it) => ({
      ...it,
      awaitingReply: Number(it.awaitingReply) === 1,
    })),
  };
}
