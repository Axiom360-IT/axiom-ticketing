import "server-only";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { safeLocalMoment } from "@/lib/automations/schedule";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { attachments } from "@/lib/db/schema/attachments";
import { ticketChangeEvents } from "@/lib/db/schema/automation-rules";
import { holidays } from "@/lib/db/schema/holidays";
import { messages } from "@/lib/db/schema/messages";
import { organizations } from "@/lib/db/schema/organizations";
import { roles, userRoles } from "@/lib/db/schema/rbac";
import { ticketParticipants } from "@/lib/db/schema/ticket-participants";
import { tickets } from "@/lib/db/schema/tickets";
import { workLogs } from "@/lib/db/schema/work-logs";
import { getSettings } from "@/lib/settings";
import { toIsoDate } from "@/lib/sla-compute";
import type { FactSheet } from "./types";

// ── Building the facts the evaluator reads ────────────────────────────
//
// Batched throughout: one query per CONCERN, never one per ticket. The SLA
// monitor was widened from 5 minutes to 20 to keep Neon's compute budget
// happy; an engine that issued six queries per candidate ticket would undo
// that on its first busy afternoon (invariant I10).
//
// Everything here is a read. The evaluator never queries, which is what keeps
// it pure and unit-testable.

/** Shared across one engine pass, so every rule sees one consistent clock. */
export type EngineClock = {
  now: Date;
  timezone: string;
  local: FactSheet["local"];
};

type BusinessHours = {
  timezone: string;
  startHour: number;
  endHour: number;
  workingDays: Set<string>;
};

async function loadBusinessHours(): Promise<BusinessHours> {
  const s = (await getSettings([
    "business_hours.timezone",
    "business_hours.start_hour",
    "business_hours.end_hour",
    "business_hours.working_days",
  ])) as Record<string, unknown>;

  const tz = s["business_hours.timezone"];
  const start = s["business_hours.start_hour"];
  const end = s["business_hours.end_hour"];
  const days = s["business_hours.working_days"];

  return {
    timezone: typeof tz === "string" && tz.trim() ? tz : "UTC",
    startHour: typeof start === "number" ? start : 9,
    endHour: typeof end === "number" ? end : 18,
    workingDays: new Set(
      Array.isArray(days)
        ? days.filter((d): d is string => typeof d === "string")
        : ["Mon", "Tue", "Wed", "Thu", "Fri"],
    ),
  };
}

/**
 * The clock for one engine pass.
 *
 * Computed once rather than per ticket: a pass that straddled a minute
 * boundary would otherwise evaluate two rules against two different "now"s,
 * and a rule with an `hour_of_day` condition would be non-deterministic at
 * exactly the moment someone was trying to debug it.
 */
export async function engineClock(now: Date): Promise<EngineClock> {
  const bh = await loadBusinessHours();
  const moment = safeLocalMoment(now, bh.timezone);
  const today = toIsoDate(now, bh.timezone);

  const holidayRows = await db
    .select({ date: holidays.date })
    .from(holidays)
    .where(eq(holidays.date, today))
    .limit(1);

  const isHoliday = holidayRows.length > 0;
  const workingDay = bh.workingDays.has(moment.weekday);

  return {
    now,
    timezone: bh.timezone,
    local: {
      weekday: moment.weekday,
      hour: moment.hour,
      minute: moment.minute,
      // A holiday is not inside office hours even if the clock says 11am —
      // that is the whole point of recording holidays.
      insideBusinessHours:
        workingDay &&
        !isHoliday &&
        moment.hour >= bh.startHour &&
        moment.hour < bh.endHour,
      isHoliday,
    },
  };
}

function minutesBetween(from: Date | null, to: Date): number | null {
  if (!from) return null;
  return Math.floor((to.getTime() - from.getTime()) / 60_000);
}

function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at === -1 ? null : email.slice(at + 1).toLowerCase();
}

/**
 * Load a complete FactSheet for each of the given tickets.
 *
 * Returns a Map so a caller iterating candidate ids can skip the ones that
 * vanished between the candidate query and this one — a ticket deleted
 * mid-pass is a normal event, not an error.
 */
export async function loadFacts(
  ticketIds: string[],
  clock: EngineClock,
): Promise<Map<string, FactSheet>> {
  const out = new Map<string, FactSheet>();
  if (ticketIds.length === 0) return out;

  const ids = [...new Set(ticketIds)];

  const ticketRows = await db
    .select()
    .from(tickets)
    .where(and(inArray(tickets.id, ids), isNull(tickets.deletedAt)));
  if (ticketRows.length === 0) return out;

  const liveIds = ticketRows.map((t) => t.id);
  const orgIds = [
    ...new Set(ticketRows.map((t) => t.organizationId).filter((v): v is string => !!v)),
  ];
  const assigneeIds = [
    ...new Set(ticketRows.map((t) => t.assignedToId).filter((v): v is string => !!v)),
  ];

  const [
    orgRows,
    assigneeRows,
    roleRows,
    participantRows,
    messageRows,
    attachmentRows,
    workLogRows,
    statusChangeRows,
  ] = await Promise.all([
    orgIds.length
      ? db
          .select({
            id: organizations.id,
            name: organizations.name,
            isInternal: organizations.isInternal,
            isMonthlyPlan: organizations.isMonthlyPlan,
            monthlyMinutesBalance: organizations.monthlyMinutesBalance,
          })
          .from(organizations)
          .where(inArray(organizations.id, orgIds))
      : Promise.resolve([]),
    assigneeIds.length
      ? db
          .select({ id: users.id, isActive: users.isActive })
          .from(users)
          .where(inArray(users.id, assigneeIds))
      : Promise.resolve([]),
    assigneeIds.length
      ? db
          .select({ userId: userRoles.userId, name: roles.name })
          .from(userRoles)
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(inArray(userRoles.userId, assigneeIds))
      : Promise.resolve([]),
    db
      .select({
        ticketId: ticketParticipants.ticketId,
        n: sql<number>`count(*)::int`,
      })
      .from(ticketParticipants)
      .where(
        and(
          inArray(ticketParticipants.ticketId, liveIds),
          eq(ticketParticipants.status, "active"),
        ),
      )
      .groupBy(ticketParticipants.ticketId),
    // Public (non-note, approved) messages only: counts, plus the newest
    // customer and agent timestamps, in one grouped pass.
    db
      .select({
        ticketId: messages.ticketId,
        authorType: messages.authorType,
        n: sql<number>`count(*)::int`,
        newest: sql<string>`max(${messages.createdAt})`,
      })
      .from(messages)
      .where(
        and(
          inArray(messages.ticketId, liveIds),
          eq(messages.isInternalNote, false),
          eq(messages.moderationStatus, "approved"),
        ),
      )
      .groupBy(messages.ticketId, messages.authorType),
    db
      .select({ ticketId: attachments.ticketId, n: sql<number>`count(*)::int` })
      .from(attachments)
      .where(inArray(attachments.ticketId, liveIds))
      .groupBy(attachments.ticketId),
    db
      .select({
        ticketId: workLogs.ticketId,
        minutes: sql<number>`coalesce(sum(${workLogs.minutes}),0)::int`,
      })
      .from(workLogs)
      .where(inArray(workLogs.ticketId, liveIds))
      .groupBy(workLogs.ticketId),
    // When each ticket last changed status, from the change feed.
    //
    // There is no `status_changed_at` column, and adding one would mean
    // migrating a live table for a single condition. The feed answers it
    // exactly for anything that has moved since the engine was installed;
    // for everything older the fallback is `createdAt`. That fallback reads
    // a ticket as having sat in its status LONGER than it really has, which
    // is why a new rule does not reach back over existing tickets unless the
    // operator explicitly asks (`applyToExisting`).
    db
      .select({
        ticketId: ticketChangeEvents.ticketId,
        at: sql<string>`max(${ticketChangeEvents.createdAt})`,
      })
      .from(ticketChangeEvents)
      .where(
        and(
          inArray(ticketChangeEvents.ticketId, liveIds),
          sql`${ticketChangeEvents.changed} ? 'status'`,
        ),
      )
      .groupBy(ticketChangeEvents.ticketId),
  ]);

  const orgById = new Map(orgRows.map((o) => [o.id, o]));
  const assigneeById = new Map(assigneeRows.map((u) => [u.id, u]));
  const rolesByUser = new Map<string, string[]>();
  for (const r of roleRows) {
    const list = rolesByUser.get(r.userId) ?? [];
    list.push(r.name);
    rolesByUser.set(r.userId, list);
  }
  const participantsByTicket = new Map(
    participantRows.map((r) => [r.ticketId, Number(r.n)]),
  );
  const attachmentsByTicket = new Map(
    attachmentRows.map((r) => [r.ticketId, Number(r.n)]),
  );
  const workByTicket = new Map(
    workLogRows.map((r) => [r.ticketId, Number(r.minutes)]),
  );
  const statusChangedByTicket = new Map(
    statusChangeRows.map((r) => [r.ticketId, new Date(r.at)]),
  );

  const msgStats = new Map<
    string,
    { total: number; lastCustomer: Date | null; lastAgent: Date | null }
  >();
  for (const row of messageRows) {
    const cur =
      msgStats.get(row.ticketId) ?? { total: 0, lastCustomer: null, lastAgent: null };
    cur.total += Number(row.n);
    const at = row.newest ? new Date(row.newest) : null;
    if (row.authorType === "customer") cur.lastCustomer = at;
    else if (row.authorType === "agent") cur.lastAgent = at;
    msgStats.set(row.ticketId, cur);
  }

  for (const t of ticketRows) {
    const org = t.organizationId ? orgById.get(t.organizationId) : undefined;
    const assigneeRow = t.assignedToId
      ? assigneeById.get(t.assignedToId)
      : undefined;
    const stats = msgStats.get(t.id);
    const statusSince = statusChangedByTicket.get(t.id) ?? t.createdAt;

    out.set(t.id, {
      ticket: {
        id: t.id,
        ticketNumber: t.ticketNumber,
        subject: t.subject,
        description: t.description,
        category: t.category,
        type: t.type,
        serviceType: t.serviceType,
        priority: t.priority,
        status: t.status,
        stream: t.stream,
        origin: t.origin,
        createdVia: t.createdVia,
        organizationId: t.organizationId,
        customerEmail: t.customerEmail,
        customerDomain: domainOf(t.customerEmail),
        orgMatchStatus: t.orgMatchStatus,
        billable: t.billable,
        invoiceNumber: t.invoiceNumber,
        assignedToId: t.assignedToId,
        isEscalated: t.isEscalated,
        escalationReason: t.escalationReason,
        escalationTargetRole: t.escalationTargetRole,
        csatRating: t.csatRating,
        reopenedCount: t.reopenedCount,
        firstResponseAt: t.firstResponseAt,
        resolutionDueAt: t.resolutionDueAt,
        slaBreachedAt: t.slaBreachedAt,
        slaPausedAt: t.slaPausedAt,
        resolvedAt: t.resolvedAt,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      },
      organization: org
        ? {
            id: org.id,
            name: org.name,
            isInternal: org.isInternal,
            isMonthlyPlan: org.isMonthlyPlan,
            monthlyMinutesBalance: org.monthlyMinutesBalance,
          }
        : null,
      assignee:
        t.assignedToId && assigneeRow
          ? {
              id: t.assignedToId,
              roleNames: rolesByUser.get(t.assignedToId) ?? [],
              isActive: assigneeRow.isActive,
            }
          : null,
      counts: {
        participants: participantsByTicket.get(t.id) ?? 0,
        publicMessages: stats?.total ?? 0,
        attachments: attachmentsByTicket.get(t.id) ?? 0,
        workLogMinutes: workByTicket.get(t.id) ?? 0,
      },
      timing: {
        ageMinutes: minutesBetween(t.createdAt, clock.now) ?? 0,
        minutesInStatus: minutesBetween(statusSince, clock.now) ?? 0,
        minutesSinceLastCustomerMessage: minutesBetween(
          stats?.lastCustomer ?? null,
          clock.now,
        ),
        minutesSinceLastAgentMessage: minutesBetween(
          stats?.lastAgent ?? null,
          clock.now,
        ),
        minutesSinceAssigned: minutesBetween(t.assignedAt, clock.now),
        // Negative while still in time, so `gte 0` reads as "past due" and
        // `gte 60` as "an hour late".
        minutesPastResolutionDue: t.resolutionDueAt
          ? Math.floor((clock.now.getTime() - t.resolutionDueAt.getTime()) / 60_000)
          : null,
      },
      local: clock.local,
    });
  }

  return out;
}

/** Live, non-deleted tickets only — the set every rule is allowed to see. */
export function openTicketCondition() {
  return and(
    isNull(tickets.deletedAt),
    ne(tickets.status, "resolved"),
    ne(tickets.status, "closed"),
    ne(tickets.status, "draft"),
  );
}

/** The newest change event per ticket, for debugging a rule that did fire. */
export async function lastChangeFor(ticketId: string) {
  const [row] = await db
    .select()
    .from(ticketChangeEvents)
    .where(eq(ticketChangeEvents.ticketId, ticketId))
    .orderBy(desc(ticketChangeEvents.createdAt))
    .limit(1);
  return row ?? null;
}
