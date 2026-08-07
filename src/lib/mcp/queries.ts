import "server-only";
import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  lt,
  ne,
  or,
  type SQL,
} from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema/tickets";
import { organizations } from "@/lib/db/schema/organizations";
import { users } from "@/lib/db/schema/auth";
import { messages } from "@/lib/db/schema/messages";
import { procurementRequests } from "@/lib/db/schema/procurement";
import { can, type SessionUser } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { ticketsVisibilityCondition } from "@/lib/auth/scope";
import { loadTicketScope } from "@/lib/tickets/load";
import { sanitizeMessageHtml, htmlToPlainText } from "@/lib/messages/sanitize";
import { audit } from "@/lib/audit";
import { enforceUserRateLimit } from "@/lib/ratelimit";

// Every read/write here goes through can()/ticketsVisibilityCondition — the
// EXACT same checks the admin UI uses — so an MCP token can never see or do
// more than the user it belongs to already could there. This module exists
// (rather than reusing the Server Actions in app/actions/*) because those
// call requireSessionUser(), which reads a browser cookie; the MCP
// connection authenticates via a bearer token instead, so the resolved
// SessionUser is passed in explicitly.

const MAX_LIMIT = 50;
function clampLimit(n: number | undefined): number {
  return Math.min(Math.max(n ?? 10, 1), MAX_LIMIT);
}

async function requireTicketsView(user: SessionUser): Promise<void> {
  if (!(await can(user, "tickets.view", { type: "global" }, productionContext))) {
    throw new Error("You don't have permission to view tickets.");
  }
}

const TICKET_SUMMARY_COLUMNS = {
  ticketNumber: tickets.ticketNumber,
  subject: tickets.subject,
  status: tickets.status,
  priority: tickets.priority,
  assignedToName: users.name,
  customerName: tickets.customerName,
  customerEmail: tickets.customerEmail,
  organizationName: organizations.name,
  resolutionDueAt: tickets.resolutionDueAt,
  isEscalated: tickets.isEscalated,
  createdAt: tickets.createdAt,
  updatedAt: tickets.updatedAt,
};

export type TicketSummary = Awaited<ReturnType<typeof getTicketByNumber>>;

function baseTicketQuery() {
  return db
    .select(TICKET_SUMMARY_COLUMNS)
    .from(tickets)
    .leftJoin(users, eq(users.id, tickets.assignedToId))
    .leftJoin(organizations, eq(organizations.id, tickets.organizationId));
}

const NOT_DONE = and(ne(tickets.status, "resolved"), ne(tickets.status, "closed"))!;

export async function getTicketByNumber(user: SessionUser, ticketNumber: string) {
  await requireTicketsView(user);
  const [row] = await baseTicketQuery()
    .where(
      and(
        eq(tickets.ticketNumber, ticketNumber.trim()),
        ticketsVisibilityCondition(user),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listTicketsByStatus(
  user: SessionUser,
  statuses: string[],
  limit?: number,
) {
  await requireTicketsView(user);
  return baseTicketQuery()
    .where(and(inArray(tickets.status, statuses), ticketsVisibilityCondition(user)))
    .orderBy(desc(tickets.createdAt))
    .limit(clampLimit(limit));
}

export async function listOverdueTickets(user: SessionUser, limit?: number) {
  await requireTicketsView(user);
  return baseTicketQuery()
    .where(
      and(
        lt(tickets.resolutionDueAt, new Date()),
        NOT_DONE,
        ticketsVisibilityCondition(user),
      ),
    )
    .orderBy(tickets.resolutionDueAt)
    .limit(clampLimit(limit));
}

export async function listUnassignedTickets(user: SessionUser, limit?: number) {
  await requireTicketsView(user);
  return baseTicketQuery()
    .where(and(isNull(tickets.assignedToId), NOT_DONE, ticketsVisibilityCondition(user)))
    .orderBy(desc(tickets.createdAt))
    .limit(clampLimit(limit));
}

export async function listEscalatedTickets(user: SessionUser, limit?: number) {
  await requireTicketsView(user);
  return baseTicketQuery()
    .where(and(eq(tickets.isEscalated, true), ticketsVisibilityCondition(user)))
    .orderBy(desc(tickets.createdAt))
    .limit(clampLimit(limit));
}

export async function searchCustomerOrOrgHistory(
  user: SessionUser,
  query: string,
  limit?: number,
) {
  await requireTicketsView(user);
  const q = `%${query.trim()}%`;
  return baseTicketQuery()
    .where(
      and(
        or(
          ilike(tickets.customerEmail, q),
          ilike(tickets.customerName, q),
          ilike(organizations.name, q),
        ),
        ticketsVisibilityCondition(user),
      ),
    )
    .orderBy(desc(tickets.createdAt))
    .limit(clampLimit(limit));
}

export type TicketStats = {
  open: number;
  unassigned: number;
  awaitingCustomer: number;
  onHold: number;
  escalated: number;
  resolved: number;
};

export async function getTicketStats(user: SessionUser): Promise<TicketStats> {
  await requireTicketsView(user);
  const visible = ticketsVisibilityCondition(user);
  const countWhere = async (extra: SQL) => {
    const [row] = await db
      .select({ value: count() })
      .from(tickets)
      .where(and(visible, extra));
    return row?.value ?? 0;
  };
  const [open, unassigned, awaitingCustomer, onHold, escalated, resolved] =
    await Promise.all([
      countWhere(inArray(tickets.status, ["open", "in_progress"])),
      countWhere(and(isNull(tickets.assignedToId), NOT_DONE)!),
      countWhere(eq(tickets.status, "awaiting_customer_confirmation")),
      countWhere(eq(tickets.status, "on_hold")),
      countWhere(eq(tickets.isEscalated, true)),
      countWhere(eq(tickets.status, "resolved")),
    ]);
  return { open, unassigned, awaitingCustomer, onHold, escalated, resolved };
}

export async function listProcurementByStatus(
  user: SessionUser,
  statuses: string[] | undefined,
  limit?: number,
) {
  if (
    !(await can(user, "procurement.view", { type: "global" }, productionContext))
  ) {
    throw new Error("You don't have permission to view procurement requests.");
  }
  const where =
    statuses && statuses.length > 0
      ? inArray(procurementRequests.status, statuses)
      : undefined;
  return db
    .select({
      itemName: procurementRequests.itemName,
      status: procurementRequests.status,
      quantity: procurementRequests.quantity,
      estimatedCost: procurementRequests.estimatedCost,
      vendor: procurementRequests.vendor,
      dateNeededBy: procurementRequests.dateNeededBy,
      createdAt: procurementRequests.createdAt,
    })
    .from(procurementRequests)
    .where(where)
    .orderBy(desc(procurementRequests.createdAt))
    .limit(clampLimit(limit));
}

// ── Write: post an internal note ────────────────────────────────────────
// Internal-note-only by design — never posts as a customer-visible reply.
// Mirrors app/actions/tickets.ts `addInternalNote`, adapted to take an
// explicit SessionUser and a ticket NUMBER (what the chat naturally uses)
// instead of a cookie session + uuid.

function plainTextToSafeHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export type AddTicketNoteResult =
  | { ok: true }
  | { ok: false; error: string };

export async function addTicketNoteViaMcp(
  user: SessionUser,
  ticketNumber: string,
  body: string,
): Promise<AddTicketNoteResult> {
  const trimmed = body.trim();
  if (trimmed.length === 0) return { ok: false, error: "Note cannot be empty." };

  try {
    await enforceUserRateLimit("authInternalNote", user.id);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Rate limited." };
  }

  const [row] = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.ticketNumber, ticketNumber.trim()))
    .limit(1);
  if (!row) return { ok: false, error: `No ticket found with number ${ticketNumber}.` };

  const ticket = await loadTicketScope(row.id);
  if (!ticket) return { ok: false, error: "Ticket not found." };

  if (
    !(await can(
      user,
      "tickets.internal_note",
      { type: "ticket", ticket },
      productionContext,
    ))
  ) {
    return { ok: false, error: "You don't have permission to add a note to this ticket." };
  }

  const [agent] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!agent) return { ok: false, error: "Could not resolve your account." };

  const cleanBody = sanitizeMessageHtml(plainTextToSafeHtml(trimmed));
  if (htmlToPlainText(cleanBody).length === 0) {
    return { ok: false, error: "Note cannot be empty." };
  }

  await db.insert(messages).values({
    ticketId: ticket.id,
    authorId: user.id,
    authorEmail: agent.email,
    authorName: agent.name,
    authorType: "agent",
    body: cleanBody,
    bodyFormat: "html",
    channel: "dashboard",
    isInternalNote: true,
  });

  await audit({
    actorId: user.id,
    action: "ticket.internal_note",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    after: { note: htmlToPlainText(cleanBody), via: "mcp" },
  });

  return { ok: true };
}
