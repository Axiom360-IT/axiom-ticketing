import "server-only";
import { and, count, desc, eq, gte, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { organizations } from "@/lib/db/schema/organizations";
import { tickets } from "@/lib/db/schema/tickets";
import { workLogs } from "@/lib/db/schema/work-logs";
import { slaRadarCondition } from "@/lib/tickets/ticket-filter-conditions";
import type { AgeBucket } from "./metrics";

// ── Dashboard widget queries ──────────────────────────────────────────────
//
// Read-only aggregates behind the on-demand chart widgets. Each returns raw
// rows; metrics.ts and widget-data.ts shape and translate them. Like the
// existing dashboard counts these are org-wide (not visibility-scoped): the
// widgets are only offered to oversight roles (see widgets.ts).
//
// "Active" means in flight: not deleted, not a draft, not resolved or closed.

const ACTIVE = and(
  isNull(tickets.deletedAt),
  notInArray(tickets.status, ["draft", "resolved", "closed"]),
);

// Overdue = past the SLA target, by the same rule as the dashboard's SLA card.
const BREACHED = slaRadarCondition("breached");
const overdueCount = () => sql<number>`count(*) filter (where ${BREACHED})`.mapWith(Number);

const num = (n: unknown) => Number(n ?? 0);

/** Active tickets per primary assignee; `userId: null` is the unassigned pile. */
export async function activeByTechnician() {
  const rows = await db
    .select({ userId: tickets.assignedToId, name: users.name, value: count(), overdue: overdueCount() })
    .from(tickets)
    .leftJoin(users, eq(users.id, tickets.assignedToId))
    .where(ACTIVE)
    .groupBy(tickets.assignedToId, users.name)
    .orderBy(desc(count()));
  return rows.map((r) => ({ userId: r.userId, name: r.name, value: num(r.value), overdue: num(r.overdue) }));
}

/** Active tickets grouped by one of their own text columns. */
export async function activeByColumn(column: "category" | "type" | "stream") {
  const col = tickets[column];
  const rows = await db
    .select({ key: col, value: count(), overdue: overdueCount() })
    .from(tickets)
    .where(ACTIVE)
    .groupBy(col)
    .orderBy(desc(count()));
  return rows.map((r) => ({ key: r.key, value: num(r.value), overdue: num(r.overdue) }));
}

/** Active tickets per organization; `id: null` = tickets with no organization. */
export async function activeByOrganization() {
  const rows = await db
    .select({ id: tickets.organizationId, name: organizations.name, value: count(), overdue: overdueCount() })
    .from(tickets)
    .leftJoin(organizations, eq(organizations.id, tickets.organizationId))
    .where(ACTIVE)
    .groupBy(tickets.organizationId, organizations.name)
    .orderBy(desc(count()));
  return rows.map((r) => ({ id: r.id, name: r.name, value: num(r.value), overdue: num(r.overdue) }));
}

/** Active tickets, and the overdue ones among them, counted into age buckets by
 *  how long ago they were created. */
export async function activeAgeCounts(): Promise<
  Record<"open" | "overdue", Record<AgeBucket, number>>
> {
  const age = (lo: string | null, hi: string | null) => {
    const parts = [];
    if (lo) parts.push(sql`${tickets.createdAt} <= now() - ${sql.raw(`interval '${lo}'`)}`);
    if (hi) parts.push(sql`${tickets.createdAt} > now() - ${sql.raw(`interval '${hi}'`)}`);
    return sql.join(parts, sql` and `);
  };
  const buckets: Record<AgeBucket, [string | null, string | null]> = {
    d0_1: [null, "1 day"],
    d1_3: ["1 day", "3 days"],
    d3_7: ["3 days", "7 days"],
    d7_14: ["7 days", "14 days"],
    d14_plus: ["14 days", null],
  };
  const countBuckets = async (only?: SQL) => {
    const column = (k: AgeBucket) =>
      sql<number>`count(*) filter (where ${age(...buckets[k])})`.mapWith(Number);
    const [row] = await db
      .select({
        d0_1: column("d0_1"),
        d1_3: column("d1_3"),
        d3_7: column("d3_7"),
        d7_14: column("d7_14"),
        d14_plus: column("d14_plus"),
      })
      .from(tickets)
      .where(and(ACTIVE, only));
    return {
      d0_1: num(row?.d0_1),
      d1_3: num(row?.d1_3),
      d3_7: num(row?.d3_7),
      d7_14: num(row?.d7_14),
      d14_plus: num(row?.d14_plus),
    };
  };
  const [open, overdue] = await Promise.all([countBuckets(), countBuckets(BREACHED)]);
  return { open, overdue };
}

/**
 * How many tickets were still open at the end of each given UTC day. A ticket is
 * open from creation until it was resolved or closed (whichever stamp it has).
 * `days` is ascending `YYYY-MM-DD`.
 */
export async function backlogByDay(days: readonly string[]): Promise<Map<string, number>> {
  const first = days[0];
  const last = days[days.length - 1];
  const res = await db.execute(sql`
    SELECT to_char(d, 'YYYY-MM-DD') AS day, count(t.id)::int AS value
    FROM generate_series(${first}::date, ${last}::date, interval '1 day') AS d
    LEFT JOIN tickets t
      ON t.deleted_at IS NULL
     AND t.status <> 'draft'
     AND t.created_at < ((d + interval '1 day') AT TIME ZONE 'UTC')
     AND (coalesce(t.resolved_at, t.closed_at) IS NULL
          OR coalesce(t.resolved_at, t.closed_at) >= ((d + interval '1 day') AT TIME ZONE 'UTC'))
    GROUP BY d
    ORDER BY d`);
  return new Map((res.rows as { day: string; value: number }[]).map((r) => [r.day, num(r.value)]));
}

/** Average seconds from creation to first reply, by the UTC day of the reply. */
export async function avgFirstResponseByDay(since: Date): Promise<Map<string, number>> {
  const day = sql<string>`to_char(${tickets.firstResponseAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
  const rows = await db
    .select({
      day,
      seconds: sql<number>`avg(extract(epoch from (${tickets.firstResponseAt} - ${tickets.createdAt})))`.mapWith(Number),
    })
    .from(tickets)
    .where(and(isNull(tickets.deletedAt), gte(tickets.firstResponseAt, since)))
    .groupBy(day);
  return new Map(rows.map((r) => [r.day, num(r.seconds)]));
}

/** Average seconds from creation to resolution, by the UTC day it was resolved. */
export async function avgResolutionByDay(since: Date): Promise<Map<string, number>> {
  const day = sql<string>`to_char(${tickets.resolvedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
  const rows = await db
    .select({
      day,
      seconds: sql<number>`avg(extract(epoch from (${tickets.resolvedAt} - ${tickets.createdAt})))`.mapWith(Number),
    })
    .from(tickets)
    .where(and(isNull(tickets.deletedAt), gte(tickets.resolvedAt, since)))
    .groupBy(day);
  return new Map(rows.map((r) => [r.day, num(r.seconds)]));
}

/** Of tickets resolved since `since`, how many carried an SLA breach stamp. */
export async function slaOutcome(since: Date): Promise<{ total: number; breached: number }> {
  const [row] = await db
    .select({
      total: count(),
      breached: sql<number>`count(*) filter (where ${tickets.slaBreachedAt} is not null)`.mapWith(Number),
    })
    .from(tickets)
    .where(and(isNull(tickets.deletedAt), gte(tickets.resolvedAt, since)));
  return { total: num(row?.total), breached: num(row?.breached) };
}

/** Of tickets created since `since`, how many were escalated. */
export async function escalationOutcome(since: Date): Promise<{ total: number; escalated: number }> {
  const [row] = await db
    .select({
      total: count(),
      escalated: sql<number>`count(*) filter (where ${tickets.isEscalated} = true)`.mapWith(Number),
    })
    .from(tickets)
    .where(
      and(isNull(tickets.deletedAt), notInArray(tickets.status, ["draft"]), gte(tickets.createdAt, since)),
    );
  return { total: num(row?.total), escalated: num(row?.escalated) };
}

/** Minutes logged per technician since `since`. */
export async function minutesByTechnician(since: Date) {
  const rows = await db
    .select({
      userId: workLogs.technicianId,
      name: sql<string | null>`max(coalesce(${users.name}, ${workLogs.technicianName}))`,
      minutes: sql<number>`coalesce(sum(${workLogs.minutes}), 0)`.mapWith(Number),
    })
    .from(workLogs)
    .leftJoin(users, eq(users.id, workLogs.technicianId))
    .where(gte(workLogs.createdAt, since))
    .groupBy(workLogs.technicianId)
    .orderBy(desc(sql`coalesce(sum(${workLogs.minutes}), 0)`));
  return rows.map((r) => ({ userId: r.userId, name: r.name, minutes: num(r.minutes) }));
}

/** Minutes logged since `since`, by the billing category of the ticket they belong to. */
export async function minutesByBilling(since: Date) {
  const rows = await db
    .select({
      billable: tickets.billable,
      minutes: sql<number>`coalesce(sum(${workLogs.minutes}), 0)`.mapWith(Number),
    })
    .from(workLogs)
    .innerJoin(tickets, eq(tickets.id, workLogs.ticketId))
    .where(and(gte(workLogs.createdAt, since), isNull(tickets.deletedAt)))
    .groupBy(tickets.billable)
    .orderBy(desc(sql`coalesce(sum(${workLogs.minutes}), 0)`));
  return rows.map((r) => ({ billable: r.billable, minutes: num(r.minutes) }));
}
