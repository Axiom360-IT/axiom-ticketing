import { and, count, eq, notInArray, sql } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/can";
import { ticketsVisibilityCondition } from "@/lib/auth/scope";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { organizations } from "@/lib/db/schema/organizations";
import { tickets } from "@/lib/db/schema/tickets";

// ── Open escalations board — oversight of escalated tickets ───────────────
//
// Escalation is a FLAG (tickets.is_escalated), not a status, so escalated
// tickets keep their normal open/in_progress status and never surface on the
// dashboard's status donut — they're effectively invisible today. This lists
// the still-in-flight escalations, oldest-escalated first, so the roles that
// can act on them (deescalate / reassign) see what's waiting on a decision.
//
// Scoped through `ticketsVisibilityCondition(user)`; intended for oversight
// roles (a strict Technician sees their own via the "Escalated to me" chip in
// My Queue). The row carries the target role + reason so the whole escalation
// queue is legible at a glance without per-role filtering.

export type EscalationItem = {
  id: string;
  ticketNumber: string;
  subject: string;
  priority: string;
  status: string;
  escalationReason: string | null;
  escalationTargetRole: string | null;
  escalatedAt: Date | null;
  organizationName: string | null;
  organizationAbbreviation: string | null;
  assignedToName: string | null;
};

export type EscalationsBoard = {
  total: number;
  items: EscalationItem[];
};

const ESCALATIONS_LIMIT = 6;

export async function loadEscalationsBoard(
  user: SessionUser,
): Promise<EscalationsBoard> {
  const where = and(
    ticketsVisibilityCondition(user),
    eq(tickets.isEscalated, true),
    notInArray(tickets.status, ["resolved", "closed"]),
  );

  const [countRows, items] = await Promise.all([
    db.select({ value: count() }).from(tickets).where(where),
    db
      .select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        subject: tickets.subject,
        priority: tickets.priority,
        status: tickets.status,
        escalationReason: tickets.escalationReason,
        escalationTargetRole: tickets.escalationTargetRole,
        escalatedAt: tickets.escalatedAt,
        organizationName: organizations.name,
        organizationAbbreviation: organizations.abbreviation,
        assignedToName: users.name,
      })
      .from(tickets)
      .leftJoin(organizations, eq(organizations.id, tickets.organizationId))
      .leftJoin(users, eq(users.id, tickets.assignedToId))
      .where(where)
      // Oldest escalation first — the ones that have been waiting on a decision
      // the longest float to the top.
      .orderBy(
        sql`${tickets.escalatedAt} asc nulls last`,
        tickets.createdAt,
      )
      .limit(ESCALATIONS_LIMIT),
  ]);

  return {
    total: Number(countRows[0]?.value ?? 0),
    items,
  };
}
