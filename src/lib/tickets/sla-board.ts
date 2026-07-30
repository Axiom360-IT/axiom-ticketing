import { and, eq, isNotNull, isNull, notInArray, or, sql } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/can";
import { ticketsVisibilityCondition } from "@/lib/auth/scope";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { organizations } from "@/lib/db/schema/organizations";
import { tickets } from "@/lib/db/schema/tickets";

// ── SLA deadline board — the oversight companion to "My Queue" ────────────
//
// The SLA monitor stamps `sla_warning_80_at` and `sla_breached_at` on tickets
// as they approach / cross their resolution target, and emails about them — but
// none of that live state ever reached the dashboard (Reports only has a
// backward-looking all-time compliance ratio). This surfaces the actionable
// slice: in-flight tickets that are already BREACHED or in the 80% warning band,
// ranked most-overdue-first, so an oversight user can act before the next breach.
//
// Scoped through `ticketsVisibilityCondition(user)` so it never shows a ticket
// the caller can't already see (and returns nothing for a role with no ticket
// visibility). Intended for elevated roles; a strict Technician gets their own
// at-risk slice inside My Queue instead of this global board.

export type SlaBoardItem = {
  id: string;
  ticketNumber: string;
  subject: string;
  priority: string;
  status: string;
  isEscalated: boolean;
  // The deadline the ticket's live SLA state actually refers to: its response
  // target while still unanswered, otherwise its resolution target — mirroring
  // how the monitor picks which target to stamp. Null only in degenerate cases.
  dueAt: Date | null;
  organizationName: string | null;
  organizationAbbreviation: string | null;
  assignedToName: string | null;
  state: "breached" | "at_risk";
};

export type SlaBoard = {
  counts: { breached: number; atRisk: number };
  items: SlaBoardItem[];
};

const SLA_BOARD_LIMIT = 6;

export async function loadSlaBoard(user: SessionUser): Promise<SlaBoard> {
  // On the radar = in-flight (not resolved/closed; drafts + soft-deletes are
  // already excluded by the visibility condition) AND either breached or in the
  // 80% warning band. The stamp columns persist after resolution, so the
  // status exclusion is what keeps the board to still-actionable tickets.
  const onRadar = and(
    ticketsVisibilityCondition(user),
    notInArray(tickets.status, ["resolved", "closed"]),
    // Paused tickets (Awaiting customer / On hold) are off the SLA clock —
    // keep them off the radar so waiting time isn't flagged as at-risk.
    isNull(tickets.slaPausedAt),
    or(isNotNull(tickets.slaBreachedAt), isNotNull(tickets.slaWarning80At)),
  );

  // The SLA stamps refer to whichever target the monitor is tracking: the
  // response target while the ticket is still unanswered, otherwise the
  // resolution target (see sla-monitor.ts). Order + display against that SAME
  // deadline so a breached response SLA never shows a future resolution time
  // beside an "Overdue" badge.
  const activeDueSql = sql`(case when ${tickets.firstResponseAt} is null and ${tickets.responseDueAt} is not null then ${tickets.responseDueAt} else ${tickets.resolutionDueAt} end)`;

  const [countsRows, rows] = await Promise.all([
    db
      .select({
        breached: sql<number>`count(*) filter (where ${tickets.slaBreachedAt} is not null)`.mapWith(Number),
        atRisk: sql<number>`count(*) filter (where ${tickets.slaWarning80At} is not null and ${tickets.slaBreachedAt} is null)`.mapWith(Number),
      })
      .from(tickets)
      .where(onRadar),
    db
      .select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        subject: tickets.subject,
        priority: tickets.priority,
        status: tickets.status,
        isEscalated: tickets.isEscalated,
        // Real columns (Drizzle maps each to Date|null); the active deadline is
        // derived from them in JS so its type is a guaranteed Date, not a
        // driver-dependent raw-SQL value.
        slaBreachedAt: tickets.slaBreachedAt,
        responseDueAt: tickets.responseDueAt,
        resolutionDueAt: tickets.resolutionDueAt,
        firstResponseAt: tickets.firstResponseAt,
        organizationName: organizations.name,
        organizationAbbreviation: organizations.abbreviation,
        assignedToName: users.name,
      })
      .from(tickets)
      .leftJoin(organizations, eq(organizations.id, tickets.organizationId))
      .leftJoin(users, eq(users.id, tickets.assignedToId))
      .where(onRadar)
      // Breached first, then nearest ACTIVE deadline (most overdue floats up
      // because past instants sort ahead), then oldest.
      .orderBy(
        sql`${tickets.slaBreachedAt} is not null desc`,
        sql`${activeDueSql} asc nulls last`,
        tickets.createdAt,
      )
      .limit(SLA_BOARD_LIMIT),
  ]);

  const c = countsRows[0];
  return {
    counts: {
      breached: Number(c?.breached ?? 0),
      atRisk: Number(c?.atRisk ?? 0),
    },
    items: rows.map((r) => {
      // Mirror the monitor's target choice so the shown deadline matches the
      // SLA state (response while unanswered, else resolution).
      const dueAt =
        r.firstResponseAt === null && r.responseDueAt !== null
          ? r.responseDueAt
          : r.resolutionDueAt;
      return {
        id: r.id,
        ticketNumber: r.ticketNumber,
        subject: r.subject,
        priority: r.priority,
        status: r.status,
        isEscalated: r.isEscalated,
        dueAt,
        organizationName: r.organizationName,
        organizationAbbreviation: r.organizationAbbreviation,
        assignedToName: r.assignedToName,
        state: r.slaBreachedAt ? ("breached" as const) : ("at_risk" as const),
      };
    }),
  };
}
