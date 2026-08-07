import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can, type SessionUser } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { db, transactional } from "@/lib/db/client";
import { attachments } from "@/lib/db/schema/attachments";
import { users } from "@/lib/db/schema/auth";
import { messages } from "@/lib/db/schema/messages";
import { ticketAssignees } from "@/lib/db/schema/ticket-assignees";
import { tickets } from "@/lib/db/schema/tickets";
import { workLogs } from "@/lib/db/schema/work-logs";
import { sendEmail } from "@/lib/email/send";
import { getAppUrl } from "@/lib/request";
import { loadTicketScope } from "@/lib/tickets/load";
import { classifyStream } from "@/lib/tickets/stream";
import { resolveTicketOrgById, ticketsShareOrg } from "@/lib/tickets/org";
import { syncMonthlyPlanDeduction } from "@/lib/tickets/billing";
import { notifyBalanceChanged } from "@/lib/billing/events";
import { htmlToPlainText, sanitizeMessageHtml } from "@/lib/messages/sanitize";
import { inngest } from "@/inngest/client";
import { dispatchTicketCreated } from "@/lib/notifications/dispatch-ticket-created";
import {
  computeDueTimesForNewTicket,
  recomputeSlaForTicket,
  type Priority,
} from "@/lib/sla";
import { generateTicketNumber } from "@/lib/ticket-number";
import { isActiveCategoryValue } from "@/lib/tickets/categories";
import { isActiveTypeValue } from "@/lib/tickets/types";
import {
  csatFeedbackUrl,
  guestTicketUrl,
  ticketTrackingUrl,
} from "@/lib/tokens";

// Mirrors app/actions/tickets.ts's mutating actions, adapted to take an
// explicit SessionUser (MCP auths via bearer token, not a browser cookie —
// requireSessionUser()/headers()/cookies() don't work here) and to accept a
// ticket NUMBER (e.g. "AX-0042") instead of a uuid, since that's what a chat
// conversation naturally uses. Every permission check, business rule, and
// side effect (customer notification, audit entry, SLA math) is copied
// verbatim from the source action it mirrors — see the comment above each
// function for the exact function name + line range it was ported from.

const TICKET_PRIORITIES = ["low", "medium", "high", "critical"] as const;
const WORKING_STATUSES = [
  "open",
  "in_progress",
  "awaiting_customer_confirmation",
  "on_hold",
] as const;
const ESCALATION_REASONS = [
  "beyond_scope",
  "requires_access",
  "critical_impact",
  "vendor_involvement",
  "other",
] as const;
const ESCALATION_TARGET_ROLES = ["IT Director", "Coordinator", "Super Admin"] as const;

type Result = { ok: true; [k: string]: unknown } | { ok: false; error: string };

async function resolveTicketScope(ticketNumber: string) {
  const [row] = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.ticketNumber, ticketNumber.trim().toUpperCase()))
    .limit(1);
  if (!row) return null;
  return loadTicketScope(row.id);
}

async function loadAgent(userId: string) {
  const [agent] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return agent ?? null;
}

// ── create_ticket ──────────────────────────────────────────────────────
// Mirrors createTicketOnBehalf (app/actions/tickets.ts ~508-640).
export async function createTicketOnBehalfViaMcp(
  user: SessionUser,
  input: {
    customerName: string;
    customerEmail: string;
    subject: string;
    description: string;
    category: string;
    type: string;
    priority: (typeof TICKET_PRIORITIES)[number];
    organizationId?: string;
  },
): Promise<Result & { ticketNumber?: string }> {
  if (!(await can(user, "tickets.create", { type: "global" }, productionContext))) {
    return { ok: false, error: "You don't have permission to create tickets." };
  }
  if (!(await isActiveCategoryValue(input.category))) {
    return { ok: false, error: "Invalid category." };
  }
  if (!(await isActiveTypeValue(input.type))) {
    return { ok: false, error: "Invalid type." };
  }

  const stream = await classifyStream(input.customerEmail);
  const org = await resolveTicketOrgById(input.organizationId ?? null);
  const orgMatchStatus = org.organizationId ? "staff" : "none";
  const ticketNumber = await generateTicketNumber(org.prefix, org.timeZone);
  const createdAt = new Date();
  const { responseDueAt, resolutionDueAt } = await computeDueTimesForNewTicket({
    createdAt,
    priority: input.priority as Priority,
  });

  const ticketId = await transactional(async (tx) => {
    const [ticket] = await tx
      .insert(tickets)
      .values({
        ticketNumber,
        organizationId: org.organizationId,
        orgMatchStatus,
        subject: input.subject,
        description: input.description,
        category: input.category,
        type: input.type,
        priority: input.priority,
        status: "open",
        stream,
        origin: "portal",
        createdVia: "manual",
        customerEmail: input.customerEmail,
        customerName: input.customerName,
        createdAt,
        responseDueAt,
        resolutionDueAt,
      })
      .returning({ id: tickets.id });
    await tx.insert(messages).values({
      ticketId: ticket.id,
      authorEmail: input.customerEmail,
      authorName: input.customerName,
      authorType: "customer",
      body: input.description,
      channel: "portal",
    });
    return ticket.id;
  });

  await audit({
    actorId: user.id,
    action: "ticket.create_on_behalf",
    targetType: "ticket",
    targetId: ticketNumber,
    after: {
      ticketNumber,
      subject: input.subject,
      category: input.category,
      priority: input.priority,
      stream,
      customerEmail: input.customerEmail,
      via: "mcp",
    },
  });

  try {
    const appUrl = getAppUrl();
    const trackingUrl = guestTicketUrl(appUrl, ticketNumber, input.customerEmail);
    await sendEmail({
      to: input.customerEmail,
      template: {
        template: "ticket_created",
        data: {
          ticketNumber,
          customerName: input.customerName,
          subject: input.subject,
          trackingUrl,
        },
      },
      ticketNumber,
      replyToTicket: true,
    });
  } catch (err) {
    console.error("[createTicketOnBehalfViaMcp] confirmation email failed:", err);
  }

  try {
    await dispatchTicketCreated({
      ticketId,
      ticketNumber,
      customerName: input.customerName,
      subject: input.subject,
      appUrl: getAppUrl(),
    });
  } catch (err) {
    console.error("[createTicketOnBehalfViaMcp] new-ticket dispatch failed:", err);
  }

  return { ok: true, ticketNumber };
}

// ── assign_ticket ──────────────────────────────────────────────────────
// Mirrors assignTicket (app/actions/tickets.ts ~644-730ish).
export async function assignTicketViaMcp(
  user: SessionUser,
  ticketNumber: string,
  technicianEmail: string,
): Promise<Result> {
  const ticket = await resolveTicketScope(ticketNumber);
  if (!ticket) return { ok: false, error: `No ticket found with number ${ticketNumber}.` };
  if (
    !(await can(user, "tickets.assign", { type: "ticket", ticket }, productionContext))
  ) {
    return { ok: false, error: "You don't have permission to assign this ticket." };
  }

  const [tech] = await db
    .select({
      id: users.id,
      name: users.name,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.email, technicianEmail.trim().toLowerCase()))
    .limit(1);
  if (!tech) return { ok: false, error: `No user found with email ${technicianEmail}.` };
  if (!tech.isActive) return { ok: false, error: "Cannot assign to a deactivated user." };

  const before = { assignedToId: ticket.assignedToId };
  const newStatus = ticket.status === "open" ? "in_progress" : ticket.status;

  await transactional(async (tx) => {
    await tx
      .update(tickets)
      .set({
        assignedToId: tech.id,
        assignedAt: new Date(),
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(tickets.id, ticket.id));
    await tx
      .delete(ticketAssignees)
      .where(and(eq(ticketAssignees.ticketId, ticket.id), eq(ticketAssignees.userId, tech.id)));
  });

  await audit({
    actorId: user.id,
    action: "ticket.assign",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    before,
    after: { assignedToId: tech.id, status: newStatus, via: "mcp" },
  });

  return { ok: true, assignedTo: tech.name };
}

// ── delete_ticket ──────────────────────────────────────────────────────
// Mirrors deleteTicket (app/actions/tickets.ts ~954-994). Soft delete only
// (sets deletedAt) — never a hard DB delete.
export async function deleteTicketViaMcp(
  user: SessionUser,
  ticketNumber: string,
): Promise<Result> {
  const ticket = await resolveTicketScope(ticketNumber);
  if (!ticket) return { ok: false, error: `No ticket found with number ${ticketNumber}.` };
  if (
    !(await can(user, "tickets.delete", { type: "ticket", ticket }, productionContext))
  ) {
    return { ok: false, error: "You don't have permission to delete this ticket." };
  }
  if (ticket.deletedAt) return { ok: false, error: "Ticket is already deleted." };

  const now = new Date();
  await db
    .update(tickets)
    .set({ deletedAt: now, deletedById: user.id, updatedAt: now })
    .where(eq(tickets.id, ticket.id));

  await audit({
    actorId: user.id,
    action: "ticket.delete",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    before: { deletedAt: null },
    after: { deletedAt: now.toISOString(), via: "mcp" },
  });

  return { ok: true };
}

// ── merge_tickets ──────────────────────────────────────────────────────
// Mirrors mergeTickets (app/actions/tickets.ts ~1012-1226). Super-Admin-only
// via the dedicated tickets.merge permission — deliberately separate from
// tickets.delete. Moves messages/attachments/worklogs, carries technicians
// per req 4.4, closes the source as a duplicate.
export async function mergeTicketsViaMcp(
  user: SessionUser,
  sourceTicketNumber: string,
  targetTicketNumber: string,
): Promise<Result> {
  const source = await resolveTicketScope(sourceTicketNumber);
  if (!source) return { ok: false, error: `No ticket found with number ${sourceTicketNumber}.` };
  if (
    !(await can(user, "tickets.merge", { type: "ticket", ticket: source }, productionContext))
  ) {
    return { ok: false, error: "You don't have permission to merge tickets." };
  }
  if (source.deletedAt) return { ok: false, error: "Source ticket has been deleted." };

  const [target] = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      status: tickets.status,
      duplicateOfId: tickets.duplicateOfId,
      deletedAt: tickets.deletedAt,
      assignedToId: tickets.assignedToId,
      organizationId: tickets.organizationId,
      customerEmail: tickets.customerEmail,
    })
    .from(tickets)
    .where(eq(tickets.ticketNumber, targetTicketNumber.trim().toUpperCase()))
    .limit(1);
  if (!target) return { ok: false, error: `No ticket found with number ${targetTicketNumber}.` };
  if (target.id === source.id) return { ok: false, error: "Can't merge a ticket into itself." };
  if (target.deletedAt) return { ok: false, error: "Target ticket has been deleted." };
  if (target.duplicateOfId) {
    return { ok: false, error: `${target.ticketNumber} is itself already a merged duplicate.` };
  }
  if (source.duplicateOfId) return { ok: false, error: "Source is already merged." };
  if (target.status === "closed" || target.status === "resolved") {
    return {
      ok: false,
      error: `Target ${target.ticketNumber} is ${target.status} — reopen it first before merging into it.`,
    };
  }

  const [sourceOrgRow] = await db
    .select({ organizationId: tickets.organizationId })
    .from(tickets)
    .where(eq(tickets.id, source.id))
    .limit(1);
  const sourceForOrg = {
    organizationId: sourceOrgRow?.organizationId ?? null,
    customerEmail: source.customerEmail,
  };
  if (!ticketsShareOrg(sourceForOrg, target)) {
    return {
      ok: false,
      error: `${target.ticketNumber} belongs to a different organization — tickets can only merge within the same organization.`,
    };
  }

  const actor = await loadAgent(user.id);
  const actorName = actor?.name ?? "Admin";
  const actorEmail = actor?.email ?? "system@local";
  const now = new Date();
  const sourceTech = source.assignedToId;
  const targetTech = target.assignedToId;
  const promoteSourceTechToPrimary = Boolean(sourceTech && !targetTech && sourceTech !== targetTech);
  const addSourceTechAsCoAssignee = Boolean(sourceTech && targetTech && sourceTech !== targetTech);

  const mergeAffectedOrgIds = await transactional(async (tx) => {
    await tx.update(messages).set({ ticketId: target.id }).where(eq(messages.ticketId, source.id));
    await tx
      .update(attachments)
      .set({ ticketId: target.id })
      .where(eq(attachments.ticketId, source.id));
    await tx.update(workLogs).set({ ticketId: target.id }).where(eq(workLogs.ticketId, source.id));

    await tx.insert(messages).values({
      ticketId: target.id,
      authorId: user.id,
      authorEmail: actorEmail,
      authorName: actorName,
      authorType: "system",
      body: `Merged from ${source.ticketNumber} by ${actorName}.`,
      bodyFormat: "text",
      channel: "system",
    });

    if (promoteSourceTechToPrimary) {
      await tx
        .update(tickets)
        .set({ assignedToId: sourceTech, assignedAt: now, updatedAt: now })
        .where(eq(tickets.id, target.id));
    } else if (addSourceTechAsCoAssignee) {
      await tx
        .insert(ticketAssignees)
        .values({ ticketId: target.id, userId: sourceTech!, assignedById: user.id })
        .onConflictDoNothing();
    }

    await tx
      .update(tickets)
      .set({ status: "closed", duplicateOfId: target.id, closedAt: now, updatedAt: now })
      .where(eq(tickets.id, source.id));
    await tx.update(tickets).set({ updatedAt: now }).where(eq(tickets.id, target.id));

    const a = await syncMonthlyPlanDeduction(tx, source.id);
    const b = await syncMonthlyPlanDeduction(tx, target.id);
    return [a, b];
  });
  await notifyBalanceChanged(mergeAffectedOrgIds);

  await audit({
    actorId: user.id,
    action: "ticket.merge",
    targetType: "ticket",
    targetId: source.ticketNumber,
    after: {
      mergedInto: target.ticketNumber,
      mergedAt: now.toISOString(),
      coAssignedTech: addSourceTechAsCoAssignee ? sourceTech : null,
      promotedTech: promoteSourceTechToPrimary ? sourceTech : null,
      via: "mcp",
    },
  });

  return { ok: true, mergedInto: target.ticketNumber };
}

// ── reply_to_ticket ──────────────────────────────────────────────────────
// Mirrors replyToTicket (app/actions/tickets.ts ~1327-1490+). CUSTOMER-VISIBLE
// — the customer is emailed (and SMS/in-app if they have an account).
export async function replyToTicketViaMcp(
  user: SessionUser,
  ticketNumber: string,
  message: string,
): Promise<Result> {
  const body = message.trim();
  if (body.length === 0) return { ok: false, error: "Reply cannot be empty." };

  const ticket = await resolveTicketScope(ticketNumber);
  if (!ticket) return { ok: false, error: `No ticket found with number ${ticketNumber}.` };
  if (
    !(await can(user, "tickets.reply", { type: "ticket", ticket }, productionContext))
  ) {
    return { ok: false, error: "You don't have permission to reply on this ticket." };
  }

  const agent = await loadAgent(user.id);
  if (!agent) return { ok: false, error: "Could not resolve your account." };

  const isFirstAgentReply = ticket.status === "open";
  const cleanBody = sanitizeMessageHtml(
    `<p>${body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>`,
  );
  if (htmlToPlainText(cleanBody).length === 0) return { ok: false, error: "Reply cannot be empty." };

  await transactional(async (tx) => {
    await tx.insert(messages).values({
      ticketId: ticket.id,
      authorId: user.id,
      authorEmail: agent.email,
      authorName: agent.name,
      authorType: "agent",
      body: cleanBody,
      bodyFormat: "html",
      channel: "dashboard",
    });
    const update: Partial<typeof tickets.$inferInsert> = { updatedAt: new Date() };
    if (isFirstAgentReply) update.firstResponseAt = new Date();
    await tx.update(tickets).set(update).where(eq(tickets.id, ticket.id));
  });

  await audit({
    actorId: user.id,
    action: "ticket.reply",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    after: { reply: htmlToPlainText(cleanBody), via: "mcp" },
  });

  try {
    const appUrl = getAppUrl();
    const trackingUrl = ticketTrackingUrl({
      appUrl,
      ticketNumber: ticket.ticketNumber,
      customerEmail: ticket.customerEmail,
      customerId: ticket.customerId,
    });
    if (ticket.customerId) {
      await inngest.send({
        name: "notification/dispatch",
        data: {
          type: "ticket.agent_replied",
          recipientUserIds: [ticket.customerId],
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          email: {
            template: {
              template: "ticket_reply",
              data: {
                ticketNumber: ticket.ticketNumber,
                customerName: ticket.customerName,
                subject: ticket.subject,
                agentName: agent.name,
                body: htmlToPlainText(cleanBody),
                trackingUrl,
              },
            },
            ticketNumber: ticket.ticketNumber,
            replyToTicket: true,
          },
          sms: {
            template: { template: "agent_replied", data: { ticketNumber: ticket.ticketNumber, ticketUrl: trackingUrl } },
          },
          inApp: {
            titleArgs: { ticketNumber: ticket.ticketNumber },
            bodyArgs: {},
            linkUrl: `/portal/tickets/${ticket.ticketNumber}`,
          },
        },
      });
    } else {
      await sendEmail({
        to: ticket.customerEmail,
        template: {
          template: "ticket_reply",
          data: {
            ticketNumber: ticket.ticketNumber,
            customerName: ticket.customerName,
            subject: ticket.subject,
            agentName: agent.name,
            body: htmlToPlainText(cleanBody),
            trackingUrl,
          },
        },
        ticketNumber: ticket.ticketNumber,
        replyToTicket: true,
      });
    }
  } catch (err) {
    console.error("[replyToTicketViaMcp] customer notification failed:", err);
  }

  return { ok: true };
}

// ── resolve_ticket ──────────────────────────────────────────────────────
// Mirrors resolveTicket (app/actions/tickets.ts ~1663-1800+).
export async function resolveTicketViaMcp(
  user: SessionUser,
  ticketNumber: string,
  resolutionNote: string,
): Promise<Result> {
  const note = resolutionNote.trim();
  if (note.length < 10) {
    return { ok: false, error: "Resolution note must be at least 10 characters." };
  }
  const ticket = await resolveTicketScope(ticketNumber);
  if (!ticket) return { ok: false, error: `No ticket found with number ${ticketNumber}.` };
  if (
    !(await can(user, "tickets.resolve", { type: "ticket", ticket }, productionContext))
  ) {
    return { ok: false, error: "You don't have permission to resolve this ticket." };
  }
  if (ticket.status === "resolved" || ticket.status === "closed") {
    return { ok: false, error: "Ticket is already resolved or closed." };
  }

  const agent = await loadAgent(user.id);
  if (!agent) return { ok: false, error: "Could not resolve your account." };

  await transactional(async (tx) => {
    await tx.insert(messages).values({
      ticketId: ticket.id,
      authorId: user.id,
      authorEmail: agent.email,
      authorName: agent.name,
      authorType: "agent",
      body: note,
      channel: "dashboard",
      isResolutionNote: true,
    });
    await tx
      .update(tickets)
      .set({ status: "resolved", resolvedAt: new Date(), updatedAt: new Date(), slaPausedAt: null })
      .where(eq(tickets.id, ticket.id));
  });

  await audit({
    actorId: user.id,
    action: "ticket.resolve",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    before: { status: ticket.status },
    after: { status: "resolved", resolution_note_provided: true, via: "mcp" },
  });

  try {
    await inngest.send({ name: "billing/ticket.resolved", data: { ticketId: ticket.id } });
  } catch (err) {
    console.error("[resolveTicketViaMcp] accountant billing dispatch failed:", err);
  }

  try {
    const appUrl = getAppUrl();
    const trackingUrl = ticketTrackingUrl({
      appUrl,
      ticketNumber: ticket.ticketNumber,
      customerEmail: ticket.customerEmail,
      customerId: ticket.customerId,
    });
    const csatHappyUrl = csatFeedbackUrl(appUrl, ticket.ticketNumber, "happy");
    const csatNeutralUrl = csatFeedbackUrl(appUrl, ticket.ticketNumber, "neutral");
    const csatUnhappyUrl = csatFeedbackUrl(appUrl, ticket.ticketNumber, "unhappy");
    if (ticket.customerId) {
      await inngest.send({
        name: "notification/dispatch",
        data: {
          type: "ticket.resolved",
          recipientUserIds: [ticket.customerId],
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          email: {
            template: {
              template: "ticket_resolved",
              data: {
                ticketNumber: ticket.ticketNumber,
                customerName: ticket.customerName,
                subject: ticket.subject,
                agentName: agent.name,
                resolutionNote: note,
                trackingUrl,
                csatHappyUrl,
                csatNeutralUrl,
                csatUnhappyUrl,
              },
            },
            ticketNumber: ticket.ticketNumber,
            replyToTicket: true,
          },
          sms: { template: { template: "ticket_resolved", data: { ticketNumber: ticket.ticketNumber, ticketUrl: trackingUrl } } },
          inApp: {
            titleArgs: { ticketNumber: ticket.ticketNumber },
            bodyArgs: {},
            linkUrl: `/portal/tickets/${ticket.ticketNumber}`,
          },
        },
      });
    } else {
      await sendEmail({
        to: ticket.customerEmail,
        template: {
          template: "ticket_resolved",
          data: {
            ticketNumber: ticket.ticketNumber,
            customerName: ticket.customerName,
            subject: ticket.subject,
            agentName: agent.name,
            resolutionNote: note,
            trackingUrl,
            csatHappyUrl,
            csatNeutralUrl,
            csatUnhappyUrl,
          },
        },
        ticketNumber: ticket.ticketNumber,
        replyToTicket: true,
      });
    }
  } catch (err) {
    console.error("[resolveTicketViaMcp] customer notification failed:", err);
  }

  return { ok: true };
}

// ── reopen_ticket ──────────────────────────────────────────────────────
// Mirrors reopenTicket (app/actions/tickets.ts ~1871-1990).
export async function reopenTicketViaMcp(
  user: SessionUser,
  ticketNumber: string,
): Promise<Result> {
  const ticket = await resolveTicketScope(ticketNumber);
  if (!ticket) return { ok: false, error: `No ticket found with number ${ticketNumber}.` };
  if (
    !(await can(user, "tickets.reopen", { type: "ticket", ticket }, productionContext))
  ) {
    return { ok: false, error: "You don't have permission to reopen this ticket." };
  }
  if (ticket.status !== "resolved" && ticket.status !== "closed") {
    return { ok: false, error: "Only resolved or closed tickets can be reopened." };
  }

  const newStatus = ticket.assignedToId ? "in_progress" : "open";
  await db
    .update(tickets)
    .set({
      status: newStatus,
      resolvedAt: null,
      closedAt: null,
      reopenedCount: sql`${tickets.reopenedCount} + 1`,
      csatResponse: null,
      csatRating: null,
      csatRespondedAt: null,
      slaPausedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(tickets.id, ticket.id));

  await audit({
    actorId: user.id,
    action: "ticket.reopen",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    before: { status: ticket.status },
    after: { status: newStatus, via: "mcp" },
  });

  try {
    const appUrl = getAppUrl();
    const trackingUrl = ticketTrackingUrl({
      appUrl,
      ticketNumber: ticket.ticketNumber,
      customerEmail: ticket.customerEmail,
      customerId: ticket.customerId,
    });
    if (ticket.customerId) {
      await inngest.send({
        name: "notification/dispatch",
        data: {
          type: "ticket.reopened",
          recipientUserIds: [ticket.customerId],
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          email: {
            template: {
              template: "ticket_reopened",
              data: {
                ticketNumber: ticket.ticketNumber,
                customerName: ticket.customerName,
                subject: ticket.subject,
                reason: "agent",
                trackingUrl,
              },
            },
            ticketNumber: ticket.ticketNumber,
            replyToTicket: true,
          },
          sms: { template: { template: "ticket_reopened", data: { ticketNumber: ticket.ticketNumber, ticketUrl: trackingUrl } } },
          inApp: {
            titleArgs: { ticketNumber: ticket.ticketNumber },
            bodyArgs: { reason: "A team member has reopened your ticket." },
            linkUrl: `/portal/tickets/${ticket.ticketNumber}`,
          },
        },
      });
    } else {
      await sendEmail({
        to: ticket.customerEmail,
        template: {
          template: "ticket_reopened",
          data: {
            ticketNumber: ticket.ticketNumber,
            customerName: ticket.customerName,
            subject: ticket.subject,
            reason: "agent",
            trackingUrl,
          },
        },
        ticketNumber: ticket.ticketNumber,
        replyToTicket: true,
      });
    }
  } catch (err) {
    console.error("[reopenTicketViaMcp] customer notification failed:", err);
  }

  return { ok: true };
}

// ── set_ticket_status ──────────────────────────────────────────────────
// Mirrors setTicketStatus (app/actions/tickets.ts ~2009-2098) — the working-
// status control (open/in_progress/awaiting_customer_confirmation/on_hold),
// with the SLA-pause freeze/resume math preserved exactly.
export async function setTicketStatusViaMcp(
  user: SessionUser,
  ticketNumber: string,
  status: (typeof WORKING_STATUSES)[number],
): Promise<Result> {
  if (!WORKING_STATUSES.includes(status)) return { ok: false, error: "Invalid status." };
  const ticket = await resolveTicketScope(ticketNumber);
  if (!ticket) return { ok: false, error: `No ticket found with number ${ticketNumber}.` };
  if (
    !(await can(user, "tickets.update", { type: "ticket", ticket }, productionContext))
  ) {
    return { ok: false, error: "You don't have permission to update this ticket." };
  }
  if (ticket.status === "resolved" || ticket.status === "closed" || ticket.status === "draft") {
    return { ok: false, error: "Use resolve or reopen to change a resolved or closed ticket." };
  }
  if (ticket.status === status) return { ok: true };

  const now = new Date();
  const PAUSE_STATUSES = ["awaiting_customer_confirmation", "on_hold"] as const;
  const wasPaused = (PAUSE_STATUSES as readonly string[]).includes(ticket.status);
  const willPause = (PAUSE_STATUSES as readonly string[]).includes(status);
  const slaUpdate: Partial<typeof tickets.$inferInsert> = {};
  if (!wasPaused && willPause) {
    slaUpdate.slaPausedAt = now;
  } else if (wasPaused && !willPause) {
    const pausedSince = ticket.slaPausedAt;
    if (pausedSince) {
      const delta = now.getTime() - pausedSince.getTime();
      if (delta > 0) {
        if (ticket.responseDueAt) slaUpdate.responseDueAt = new Date(ticket.responseDueAt.getTime() + delta);
        if (ticket.resolutionDueAt) slaUpdate.resolutionDueAt = new Date(ticket.resolutionDueAt.getTime() + delta);
      }
    }
    slaUpdate.slaPausedAt = null;
  }

  await db
    .update(tickets)
    .set({ status, updatedAt: now, ...slaUpdate })
    .where(eq(tickets.id, ticket.id));

  await audit({
    actorId: user.id,
    action: "ticket.status_change",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    before: { status: ticket.status },
    after: { status, via: "mcp" },
  });

  return { ok: true };
}

// ── set_ticket_priority / category / type ───────────────────────────────
// Mirrors setTicketPriority/setTicketCategory/setTicketType
// (app/actions/tickets.ts ~2106-2242).
export async function setTicketPriorityViaMcp(
  user: SessionUser,
  ticketNumber: string,
  priority: (typeof TICKET_PRIORITIES)[number],
): Promise<Result> {
  if (!TICKET_PRIORITIES.includes(priority)) return { ok: false, error: "Invalid priority." };
  const ticket = await resolveTicketScope(ticketNumber);
  if (!ticket) return { ok: false, error: `No ticket found with number ${ticketNumber}.` };
  if (
    !(await can(user, "tickets.update", { type: "ticket", ticket }, productionContext))
  ) {
    return { ok: false, error: "You don't have permission to update this ticket." };
  }
  if (ticket.priority === priority) return { ok: true };

  await db.update(tickets).set({ priority, updatedAt: new Date() }).where(eq(tickets.id, ticket.id));
  await recomputeSlaForTicket(ticket.id);

  await audit({
    actorId: user.id,
    action: "ticket.priority_change",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    before: { priority: ticket.priority },
    after: { priority, via: "mcp" },
  });
  return { ok: true };
}

export async function setTicketCategoryViaMcp(
  user: SessionUser,
  ticketNumber: string,
  category: string,
): Promise<Result> {
  const ticket = await resolveTicketScope(ticketNumber);
  if (!ticket) return { ok: false, error: `No ticket found with number ${ticketNumber}.` };
  if (
    !(await can(user, "tickets.update", { type: "ticket", ticket }, productionContext))
  ) {
    return { ok: false, error: "You don't have permission to update this ticket." };
  }
  if (!(await isActiveCategoryValue(category))) return { ok: false, error: "Invalid category." };
  if (ticket.category === category) return { ok: true };

  await db.update(tickets).set({ category, updatedAt: new Date() }).where(eq(tickets.id, ticket.id));
  await audit({
    actorId: user.id,
    action: "ticket.category_change",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    before: { category: ticket.category },
    after: { category, via: "mcp" },
  });
  return { ok: true };
}

export async function setTicketTypeViaMcp(
  user: SessionUser,
  ticketNumber: string,
  type: string,
): Promise<Result> {
  const ticket = await resolveTicketScope(ticketNumber);
  if (!ticket) return { ok: false, error: `No ticket found with number ${ticketNumber}.` };
  if (
    !(await can(user, "tickets.update", { type: "ticket", ticket }, productionContext))
  ) {
    return { ok: false, error: "You don't have permission to update this ticket." };
  }
  if (!(await isActiveTypeValue(type))) return { ok: false, error: "Invalid type." };
  if (ticket.type === type) return { ok: true };

  await db.update(tickets).set({ type, updatedAt: new Date() }).where(eq(tickets.id, ticket.id));
  await audit({
    actorId: user.id,
    action: "ticket.type_change",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    before: { type: ticket.type },
    after: { type, via: "mcp" },
  });
  return { ok: true };
}

// ── escalate_ticket / deescalate_ticket ─────────────────────────────────
// Mirrors escalateTicket/deescalateTicket (app/actions/tickets.ts ~2561-2725).
export async function escalateTicketViaMcp(
  user: SessionUser,
  ticketNumber: string,
  reason: (typeof ESCALATION_REASONS)[number],
  note?: string,
  targetRole?: (typeof ESCALATION_TARGET_ROLES)[number],
): Promise<Result> {
  if (!ESCALATION_REASONS.includes(reason)) return { ok: false, error: "Invalid reason." };
  const ticket = await resolveTicketScope(ticketNumber);
  if (!ticket) return { ok: false, error: `No ticket found with number ${ticketNumber}.` };
  if (
    !(await can(user, "tickets.escalate", { type: "ticket", ticket }, productionContext))
  ) {
    return { ok: false, error: "You don't have permission to escalate this ticket." };
  }
  if (ticket.isEscalated) return { ok: false, error: "Ticket is already escalated." };

  const actor = await loadAgent(user.id);
  const targetRoleClean = targetRole?.length ? targetRole : null;

  await db
    .update(tickets)
    .set({
      isEscalated: true,
      escalatedAt: new Date(),
      escalatedById: user.id,
      escalationReason: reason,
      escalationNote: note?.length ? note : null,
      escalationTargetRole: targetRoleClean,
      updatedAt: new Date(),
    })
    .where(eq(tickets.id, ticket.id));

  await audit({
    actorId: user.id,
    action: "ticket.escalate",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    after: { reason, note: note ?? null, targetRole: targetRoleClean, via: "mcp" },
  });

  try {
    const appUrl = getAppUrl();
    const ticketUrl = `${appUrl}/admin/tickets/${ticket.id}`;
    const technicianName = actor?.name ?? "An agent";
    await inngest.send({
      name: "notification/dispatch",
      data: {
        type: "ticket.escalated",
        recipientRoles: [
          ...new Set([...(targetRoleClean ? [targetRoleClean] : ["IT Director", "Coordinator"]), "Super Admin"]),
        ],
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        email: {
          template: {
            template: "escalation_alert",
            data: {
              ticketNumber: ticket.ticketNumber,
              recipientName: "Team",
              subject: ticket.subject,
              technicianName,
              reason,
              customerName: ticket.customerName,
              ticketUrl,
            },
          },
          ticketNumber: ticket.ticketNumber,
        },
        sms: { template: { template: "ticket_escalated", data: { ticketNumber: ticket.ticketNumber, ticketUrl } } },
        inApp: {
          titleArgs: { ticketNumber: ticket.ticketNumber },
          bodyArgs: { technicianName, subject: ticket.subject },
          linkUrl: `/admin/tickets/${ticket.id}`,
        },
      },
    });
  } catch (err) {
    console.error("[escalateTicketViaMcp] dispatch failed:", err);
  }

  return { ok: true };
}

export async function deescalateTicketViaMcp(
  user: SessionUser,
  ticketNumber: string,
): Promise<Result> {
  const ticket = await resolveTicketScope(ticketNumber);
  if (!ticket) return { ok: false, error: `No ticket found with number ${ticketNumber}.` };
  if (
    !(await can(user, "tickets.deescalate", { type: "ticket", ticket }, productionContext))
  ) {
    return { ok: false, error: "You don't have permission to de-escalate this ticket." };
  }
  if (!ticket.isEscalated) return { ok: true };

  await db
    .update(tickets)
    .set({
      isEscalated: false,
      escalatedAt: null,
      escalatedById: null,
      escalationReason: null,
      escalationNote: null,
      escalationTargetRole: null,
      updatedAt: new Date(),
    })
    .where(eq(tickets.id, ticket.id));

  await audit({
    actorId: user.id,
    action: "ticket.deescalate",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    after: { via: "mcp" },
  });

  return { ok: true };
}

// ── MCP tool registration ────────────────────────────────────────────────

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
const CONFIRM_NOTE =
  " Before calling this, always show the user exactly what will change and get their explicit go-ahead in the chat first — never call this on the first ask.";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerTicketWriteTools(server: any, user: SessionUser): void {
  server.registerTool(
    "create_ticket",
    {
      title: "Create a ticket on behalf of a customer",
      description:
        "Creates a new ticket for a customer who called in or emailed directly (the Coordinator 'create on behalf' flow). The customer gets a confirmation email." +
        CONFIRM_NOTE,
      inputSchema: {
        customerName: z.string().min(1),
        customerEmail: z.string().email(),
        subject: z.string().min(3).max(150),
        description: z.string().min(20).max(5000),
        category: z.string().min(1),
        type: z.string().min(1),
        priority: z.enum(TICKET_PRIORITIES),
        organizationId: z.string().uuid().optional(),
      },
    },
    async (input: {
      customerName: string;
      customerEmail: string;
      subject: string;
      description: string;
      category: string;
      type: string;
      priority: (typeof TICKET_PRIORITIES)[number];
      organizationId?: string;
    }) => {
      const r = await createTicketOnBehalfViaMcp(user, input);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "assign_ticket",
    {
      title: "Assign a ticket",
      description: "Assigns a ticket to a technician by email." + CONFIRM_NOTE,
      inputSchema: { ticketNumber: z.string().min(1), technicianEmail: z.string().email() },
    },
    async ({ ticketNumber, technicianEmail }: { ticketNumber: string; technicianEmail: string }) => {
      const r = await assignTicketViaMcp(user, ticketNumber, technicianEmail);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "delete_ticket",
    {
      title: "Delete a ticket",
      description: "Soft-deletes a ticket (reversible by an admin, not shown in normal views)." + CONFIRM_NOTE,
      inputSchema: { ticketNumber: z.string().min(1) },
    },
    async ({ ticketNumber }: { ticketNumber: string }) => {
      const r = await deleteTicketViaMcp(user, ticketNumber);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "merge_tickets",
    {
      title: "Merge two duplicate tickets",
      description:
        "Merges the source ticket into the target (same organization only) — moves messages/attachments/work logs, closes the source as a duplicate. Cannot be undone automatically." +
        CONFIRM_NOTE,
      inputSchema: { sourceTicketNumber: z.string().min(1), targetTicketNumber: z.string().min(1) },
    },
    async ({ sourceTicketNumber, targetTicketNumber }: { sourceTicketNumber: string; targetTicketNumber: string }) => {
      const r = await mergeTicketsViaMcp(user, sourceTicketNumber, targetTicketNumber);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "reply_to_ticket",
    {
      title: "Reply to a ticket (customer-visible)",
      description:
        "Posts a reply the CUSTOMER WILL RECEIVE by email (and see in their portal). This is NOT an internal note. " +
        "This is a real message the customer will get — never send this without the user explicitly confirming the exact wording first, every single time.",
      inputSchema: { ticketNumber: z.string().min(1), message: z.string().min(1) },
    },
    async ({ ticketNumber, message }: { ticketNumber: string; message: string }) => {
      const r = await replyToTicketViaMcp(user, ticketNumber, message);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "resolve_ticket",
    {
      title: "Resolve a ticket",
      description:
        "Marks a ticket resolved with a resolution note (min 10 characters) and notifies the customer, asking them to confirm." +
        CONFIRM_NOTE,
      inputSchema: { ticketNumber: z.string().min(1), resolutionNote: z.string().min(10) },
    },
    async ({ ticketNumber, resolutionNote }: { ticketNumber: string; resolutionNote: string }) => {
      const r = await resolveTicketViaMcp(user, ticketNumber, resolutionNote);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "reopen_ticket",
    {
      title: "Reopen a ticket",
      description: "Reopens a resolved or closed ticket and notifies the customer." + CONFIRM_NOTE,
      inputSchema: { ticketNumber: z.string().min(1) },
    },
    async ({ ticketNumber }: { ticketNumber: string }) => {
      const r = await reopenTicketViaMcp(user, ticketNumber);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "set_ticket_status",
    {
      title: "Change a ticket's working status",
      description:
        "Moves a ticket between open, in_progress, awaiting_customer_confirmation, or on_hold. Use resolve/reopen for those transitions instead — this is for the in-flight statuses only. The response clock pauses automatically while a ticket is awaiting_customer_confirmation or on_hold." +
        CONFIRM_NOTE,
      inputSchema: { ticketNumber: z.string().min(1), status: z.enum(WORKING_STATUSES) },
    },
    async ({ ticketNumber, status }: { ticketNumber: string; status: (typeof WORKING_STATUSES)[number] }) => {
      const r = await setTicketStatusViaMcp(user, ticketNumber, status);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "set_ticket_priority",
    {
      title: "Set a ticket's priority",
      description: "Changes a ticket's priority (low/medium/high/critical) — recomputes its SLA due dates." + CONFIRM_NOTE,
      inputSchema: { ticketNumber: z.string().min(1), priority: z.enum(TICKET_PRIORITIES) },
    },
    async ({ ticketNumber, priority }: { ticketNumber: string; priority: (typeof TICKET_PRIORITIES)[number] }) => {
      const r = await setTicketPriorityViaMcp(user, ticketNumber, priority);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "set_ticket_category",
    {
      title: "Set a ticket's category",
      description: "Changes a ticket's category to one of the currently active categories." + CONFIRM_NOTE,
      inputSchema: { ticketNumber: z.string().min(1), category: z.string().min(1) },
    },
    async ({ ticketNumber, category }: { ticketNumber: string; category: string }) => {
      const r = await setTicketCategoryViaMcp(user, ticketNumber, category);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "set_ticket_type",
    {
      title: "Set a ticket's type",
      description: "Changes a ticket's type to one of the currently active types." + CONFIRM_NOTE,
      inputSchema: { ticketNumber: z.string().min(1), type: z.string().min(1) },
    },
    async ({ ticketNumber, type }: { ticketNumber: string; type: string }) => {
      const r = await setTicketTypeViaMcp(user, ticketNumber, type);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "escalate_ticket",
    {
      title: "Escalate a ticket",
      description: "Flags a ticket as escalated and alerts the target role (or IT Director/Coordinator by default) plus Super Admin." + CONFIRM_NOTE,
      inputSchema: {
        ticketNumber: z.string().min(1),
        reason: z.enum(ESCALATION_REASONS),
        note: z.string().max(1000).optional(),
        targetRole: z.enum(ESCALATION_TARGET_ROLES).optional(),
      },
    },
    async ({
      ticketNumber,
      reason,
      note,
      targetRole,
    }: {
      ticketNumber: string;
      reason: (typeof ESCALATION_REASONS)[number];
      note?: string;
      targetRole?: (typeof ESCALATION_TARGET_ROLES)[number];
    }) => {
      const r = await escalateTicketViaMcp(user, ticketNumber, reason, note, targetRole);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "deescalate_ticket",
    {
      title: "De-escalate a ticket",
      description: "Clears the escalated flag on a ticket." + CONFIRM_NOTE,
      inputSchema: { ticketNumber: z.string().min(1) },
    },
    async ({ ticketNumber }: { ticketNumber: string }) => {
      const r = await deescalateTicketViaMcp(user, ticketNumber);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );
}
