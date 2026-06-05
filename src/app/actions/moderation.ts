"use server";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { type SessionUser, can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { ticketsVisibilityCondition } from "@/lib/auth/scope";
import { requireSessionUser } from "@/lib/auth/session";
import { db, transactional } from "@/lib/db/client";
import { messages } from "@/lib/db/schema/messages";
import { tickets } from "@/lib/db/schema/tickets";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { getAppUrl } from "@/lib/request";
import { loadTicketScope } from "@/lib/tickets/load";
import {
  addOrgTrustedEmail,
  upsertParticipant,
} from "@/lib/tickets/participants";
import { inngest } from "@/inngest/client";

// Inbound-moderation queue (req 5.2). Email replies from senders whose domain
// doesn't belong to the ticket's organization are stored `held` and surfaced
// here for a coordinator to approve (post + add the sender as a participant) or
// reject. Visible per the same scope as the underlying ticket.

export type HeldMessage = {
  id: string;
  ticketId: string;
  ticketNumber: string;
  ticketSubject: string;
  authorName: string;
  authorEmail: string;
  body: string;
  createdAt: Date;
};

type Result = { ok: true } | { ok: false; error: string };

export async function listHeldMessages(): Promise<HeldMessage[]> {
  const user = await requireSessionUser();
  return db
    .select({
      id: messages.id,
      ticketId: messages.ticketId,
      ticketNumber: tickets.ticketNumber,
      ticketSubject: tickets.subject,
      authorName: messages.authorName,
      authorEmail: messages.authorEmail,
      body: messages.body,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(tickets, eq(messages.ticketId, tickets.id))
    .where(
      and(
        eq(messages.moderationStatus, "held"),
        ticketsVisibilityCondition(user),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(200);
}

async function loadHeldForModeration(messageId: string, user: SessionUser) {
  const [msg] = await db
    .select({
      id: messages.id,
      ticketId: messages.ticketId,
      authorEmail: messages.authorEmail,
      authorName: messages.authorName,
      body: messages.body,
      moderationStatus: messages.moderationStatus,
    })
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  if (!msg) throw new NotFoundError();
  const ticket = await loadTicketScope(msg.ticketId);
  if (!ticket) throw new NotFoundError();
  // Whoever can act on the ticket can moderate its held inbound (coordinators
  // see every ticket; a strict tech only their own).
  if (
    !(await can(
      user,
      "tickets.update",
      { type: "ticket", ticket },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }
  return { msg, ticket };
}

// Post a held message. `trust: "none"` = approve THIS message only (the sender
// stays moderated — "approve once"); `trust: "trust"` = also mark the sender as
// legit so future replies auto-post — org-wide when the ticket has an
// organization, else for this ticket only (guest fallback).
async function applyApproval(
  messageId: string,
  user: SessionUser,
  trust: "none" | "trust",
): Promise<Result> {
  const { msg, ticket } = await loadHeldForModeration(messageId, user);
  if (msg.moderationStatus !== "held") {
    return { ok: false, error: "This message has already been reviewed." };
  }

  // Atomic: the status flip is CONDITIONAL on the row still being 'held' (so a
  // concurrent approve/reject can't double-apply), and the trust write + ticket
  // touch commit together with it.
  let transitioned = false;
  await transactional(async (tx) => {
    const updated = await tx
      .update(messages)
      .set({
        moderationStatus: "approved",
        reviewedById: user.id,
        reviewedAt: new Date(),
      })
      .where(
        and(eq(messages.id, messageId), eq(messages.moderationStatus, "held")),
      )
      .returning({ id: messages.id });
    if (updated.length === 0) return; // someone else reviewed it first
    transitioned = true;

    if (trust === "trust") {
      if (ticket.organizationId) {
        // Org-wide trust — future replies to ANY ticket of this org auto-post.
        await addOrgTrustedEmail(
          {
            organizationId: ticket.organizationId,
            email: msg.authorEmail,
            name: msg.authorName,
            addedById: user.id,
          },
          tx,
        );
      } else {
        // Guest ticket has no org — fall back to trusting for this ticket only.
        await upsertParticipant(
          {
            ticketId: ticket.id,
            email: msg.authorEmail,
            name: msg.authorName,
            addedVia: "moderation",
            addedById: user.id,
          },
          tx,
        );
      }
    }

    await tx
      .update(tickets)
      .set({ updatedAt: new Date() })
      .where(eq(tickets.id, ticket.id));
  });

  if (!transitioned) {
    return { ok: false, error: "This message has already been reviewed." };
  }

  await audit({
    actorId: user.id,
    action: "ticket.moderate_message",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    after: {
      messageId,
      decision: trust === "trust" ? "approved_trusted" : "approved",
      from: msg.authorEmail,
    },
  });

  // The message is now live — notify the assignee like any customer reply.
  try {
    const appUrl = getAppUrl();
    const ticketUrl = `${appUrl}/admin/tickets/${ticket.id}`;
    await inngest.send({
      name: "notification/dispatch",
      data: {
        type: "ticket.customer_replied",
        recipientUserIds: ticket.assignedToId ? [ticket.assignedToId] : [],
        recipientRoles: ticket.assignedToId ? undefined : ["Coordinator"],
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        email: {
          // Staff-voiced template — NOT customer-facing `ticket_reply` (req 6.3).
          template: {
            template: "customer_replied_staff",
            data: {
              ticketNumber: ticket.ticketNumber,
              customerName: msg.authorName,
              subject: ticket.subject,
              body: msg.body,
              ticketUrl,
            },
          },
          ticketNumber: ticket.ticketNumber,
        },
        inApp: {
          titleArgs: { ticketNumber: ticket.ticketNumber },
          bodyArgs: { customerName: msg.authorName },
          linkUrl: `/admin/tickets/${ticket.id}`,
        },
      },
    });
  } catch (err) {
    console.error("[approveHeldMessage] dispatch failed:", err);
  }

  revalidatePath("/admin/moderation");
  revalidatePath(`/admin/tickets/${ticket.id}`);
  return { ok: true };
}

/** Post this held message only — the sender remains moderated ("approve once"). */
export async function approveHeldMessage(messageId: string): Promise<Result> {
  const user = await requireSessionUser();
  return applyApproval(messageId, user, "none");
}

/** Post this held message AND trust the sender so future replies auto-post
 *  (org-wide, or this ticket for a guest ticket). */
export async function approveAndTrustHeldMessage(
  messageId: string,
): Promise<Result> {
  const user = await requireSessionUser();
  return applyApproval(messageId, user, "trust");
}

export async function rejectHeldMessage(messageId: string): Promise<Result> {
  const user = await requireSessionUser();
  const { msg, ticket } = await loadHeldForModeration(messageId, user);
  if (msg.moderationStatus !== "held") {
    return { ok: false, error: "This message has already been reviewed." };
  }

  // Conditional on still-held so a concurrent decision can't double-apply.
  const updated = await db
    .update(messages)
    .set({
      moderationStatus: "rejected",
      reviewedById: user.id,
      reviewedAt: new Date(),
    })
    .where(
      and(eq(messages.id, messageId), eq(messages.moderationStatus, "held")),
    )
    .returning({ id: messages.id });
  if (updated.length === 0) {
    return { ok: false, error: "This message has already been reviewed." };
  }

  await audit({
    actorId: user.id,
    action: "ticket.moderate_message",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    after: { messageId, decision: "rejected", from: msg.authorEmail },
  });

  revalidatePath("/admin/moderation");
  return { ok: true };
}
