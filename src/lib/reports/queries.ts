import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema/auth";
import { procurementRequests } from "../db/schema/procurement";
import { tickets } from "../db/schema/tickets";

// All queries scope to non-deleted rows where applicable. Procurement
// has no soft-delete so it's just `deleted_at IS NULL` on tickets.

const NOT_DELETED = isNull(tickets.deletedAt);

function dateNDaysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60_000);
}

function dateMonthsAgo(months: number): Date {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

// ── Tickets ─────────────────────────────────────────────────────────

export type TicketHealth = {
  totalsByWindow: { week: number; month: number; allTime: number };
  byStatus: { status: string; count: number }[];
  byStream: { stream: string; count: number }[];
  averageResolutionMinutes: number | null;
  csatRate: { satisfied: number; unsatisfied: number; rate: number | null };
  escalationRate: number | null; // 0..1 over all-time tickets
  slaComplianceRate: number | null; // 0..1 over breached vs total resolved
  techLoad: {
    userId: string;
    name: string;
    assigned: number;
    resolved: number;
  }[];
};

export async function loadTicketHealth(): Promise<TicketHealth> {
  const weekAgo = dateNDaysAgo(7);
  const monthAgo = dateNDaysAgo(30);

  const [weekRow] = await db
    .select({ value: count() })
    .from(tickets)
    .where(and(NOT_DELETED, gte(tickets.createdAt, weekAgo)));
  const [monthRow] = await db
    .select({ value: count() })
    .from(tickets)
    .where(and(NOT_DELETED, gte(tickets.createdAt, monthAgo)));
  const [allRow] = await db
    .select({ value: count() })
    .from(tickets)
    .where(NOT_DELETED);

  const byStatusRows = await db
    .select({ status: tickets.status, value: count() })
    .from(tickets)
    .where(NOT_DELETED)
    .groupBy(tickets.status);
  const byStreamRows = await db
    .select({ stream: tickets.stream, value: count() })
    .from(tickets)
    .where(NOT_DELETED)
    .groupBy(tickets.stream);

  // Average resolution time over RESOLVED + CLOSED tickets that have
  // a resolved_at stamped — pulled in minutes for display friendliness.
  const [avgRow] = await db
    .select({
      avgMinutes: sql<number | null>`AVG(EXTRACT(EPOCH FROM (${tickets.resolvedAt} - ${tickets.createdAt})) / 60.0)`,
    })
    .from(tickets)
    .where(and(NOT_DELETED, isNotNull(tickets.resolvedAt)));

  const [csatYesRow] = await db
    .select({ value: count() })
    .from(tickets)
    .where(and(NOT_DELETED, eq(tickets.csatResponse, "satisfied")));
  const [csatNoRow] = await db
    .select({ value: count() })
    .from(tickets)
    .where(and(NOT_DELETED, eq(tickets.csatResponse, "unsatisfied")));

  const [escalatedRow] = await db
    .select({ value: count() })
    .from(tickets)
    .where(and(NOT_DELETED, eq(tickets.isEscalated, true)));

  const [resolvedTotalRow] = await db
    .select({ value: count() })
    .from(tickets)
    .where(
      and(
        NOT_DELETED,
        inArray(tickets.status, ["resolved", "closed"]),
      ),
    );
  const [breachedRow] = await db
    .select({ value: count() })
    .from(tickets)
    .where(
      and(
        NOT_DELETED,
        inArray(tickets.status, ["resolved", "closed"]),
        isNotNull(tickets.slaBreachedAt),
      ),
    );

  const techRows = await db
    .select({
      userId: tickets.assignedToId,
      name: users.name,
      assigned: count(),
      resolved: sql<number>`COUNT(*) FILTER (WHERE ${tickets.status} IN ('resolved','closed'))`,
    })
    .from(tickets)
    .innerJoin(users, eq(users.id, tickets.assignedToId))
    .where(and(NOT_DELETED, isNotNull(tickets.assignedToId)))
    .groupBy(tickets.assignedToId, users.name)
    .orderBy(desc(count()))
    .limit(20);

  const totalAll = Number(allRow?.value ?? 0);
  const totalEscalated = Number(escalatedRow?.value ?? 0);
  const totalResolved = Number(resolvedTotalRow?.value ?? 0);
  const totalBreached = Number(breachedRow?.value ?? 0);
  const csatSat = Number(csatYesRow?.value ?? 0);
  const csatUnsat = Number(csatNoRow?.value ?? 0);
  const csatTotal = csatSat + csatUnsat;

  return {
    totalsByWindow: {
      week: Number(weekRow?.value ?? 0),
      month: Number(monthRow?.value ?? 0),
      allTime: totalAll,
    },
    byStatus: byStatusRows.map((r) => ({
      status: r.status,
      count: Number(r.value),
    })),
    byStream: byStreamRows.map((r) => ({
      stream: r.stream,
      count: Number(r.value),
    })),
    averageResolutionMinutes:
      avgRow?.avgMinutes !== null && avgRow?.avgMinutes !== undefined
        ? Math.round(Number(avgRow.avgMinutes))
        : null,
    csatRate: {
      satisfied: csatSat,
      unsatisfied: csatUnsat,
      rate: csatTotal > 0 ? csatSat / csatTotal : null,
    },
    escalationRate: totalAll > 0 ? totalEscalated / totalAll : null,
    slaComplianceRate:
      totalResolved > 0 ? 1 - totalBreached / totalResolved : null,
    techLoad: techRows
      .filter((r): r is typeof r & { userId: string } => r.userId !== null)
      .map((r) => ({
        userId: r.userId,
        name: r.name,
        assigned: Number(r.assigned),
        resolved: Number(r.resolved),
      })),
  };
}

// ── Procurement spend ───────────────────────────────────────────────

export type ProcurementSpend = {
  totalsByWindow: { month: number; quarter: number; year: number };
  byType: { type: string; total: number }[];
  byStatus: { status: string; total: number; count: number }[];
  topItems: { itemName: string; total: number }[];
  pendingApprovals: { count: number; total: number };
};

const COMPLETED_STATUSES = ["approved", "purchased", "delivered"] as const;

const COST_NUMERIC = sql<string | null>`${procurementRequests.estimatedCost}`;
const COST_AS_FLOAT = sql<number>`COALESCE(${procurementRequests.estimatedCost}::numeric, 0)`;

export async function loadProcurementSpend(): Promise<ProcurementSpend> {
  const monthAgo = dateMonthsAgo(1);
  const quarterAgo = dateMonthsAgo(3);
  const yearAgo = dateMonthsAgo(12);

  async function totalSince(after: Date | null): Promise<number> {
    const where = after
      ? and(
          inArray(procurementRequests.status, [...COMPLETED_STATUSES]),
          gte(procurementRequests.createdAt, after),
        )
      : inArray(procurementRequests.status, [...COMPLETED_STATUSES]);
    const [row] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${COST_AS_FLOAT}), 0)`,
      })
      .from(procurementRequests)
      .where(where);
    return Number(row?.total ?? 0);
  }

  const [monthTotal, quarterTotal, yearTotal] = await Promise.all([
    totalSince(monthAgo),
    totalSince(quarterAgo),
    totalSince(yearAgo),
  ]);

  const byTypeRows = await db
    .select({
      type: procurementRequests.type,
      total: sql<string>`COALESCE(SUM(${COST_AS_FLOAT}), 0)`,
    })
    .from(procurementRequests)
    .where(inArray(procurementRequests.status, [...COMPLETED_STATUSES]))
    .groupBy(procurementRequests.type);

  const byStatusRows = await db
    .select({
      status: procurementRequests.status,
      total: sql<string>`COALESCE(SUM(${COST_AS_FLOAT}), 0)`,
      value: count(),
    })
    .from(procurementRequests)
    .groupBy(procurementRequests.status);

  const topRows = await db
    .select({
      itemName: procurementRequests.itemName,
      total: sql<string>`SUM(${COST_AS_FLOAT})`,
    })
    .from(procurementRequests)
    .where(
      and(
        inArray(procurementRequests.status, [...COMPLETED_STATUSES]),
        isNotNull(COST_NUMERIC),
      ),
    )
    .groupBy(procurementRequests.itemName)
    .orderBy(sql`SUM(${COST_AS_FLOAT}) DESC`)
    .limit(5);

  const [pendingRow] = await db
    .select({
      value: count(),
      total: sql<string>`COALESCE(SUM(${COST_AS_FLOAT}), 0)`,
    })
    .from(procurementRequests)
    .where(
      inArray(procurementRequests.status, [
        "pending_coordinator_approval",
        "pending_admin_approval",
      ]),
    );

  return {
    totalsByWindow: {
      month: monthTotal,
      quarter: quarterTotal,
      year: yearTotal,
    },
    byType: byTypeRows.map((r) => ({
      type: r.type,
      total: Number(r.total ?? 0),
    })),
    byStatus: byStatusRows.map((r) => ({
      status: r.status,
      total: Number(r.total ?? 0),
      count: Number(r.value),
    })),
    topItems: topRows.map((r) => ({
      itemName: r.itemName,
      total: Number(r.total ?? 0),
    })),
    pendingApprovals: {
      count: Number(pendingRow?.value ?? 0),
      total: Number(pendingRow?.total ?? 0),
    },
  };
}

