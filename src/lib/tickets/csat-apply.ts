import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, transactional, type Tx } from "@/lib/db/client";
import { audit } from "@/lib/audit";
import { users } from "@/lib/db/schema/auth";
import { messages } from "@/lib/db/schema/messages";
import { ticketReviews } from "@/lib/db/schema/ticket-reviews";
import { tickets } from "@/lib/db/schema/tickets";
import { sendEmail } from "@/lib/email/send";
import { dispatchTicketClosedStaff } from "@/lib/notifications/dispatch-ticket-closed-staff";
import { OVERSIGHT_ROLES } from "@/lib/notifications/audience";
import { getAppUrl } from "@/lib/request";
import { ticketTrackingUrl } from "@/lib/tokens";
import { inngest } from "@/inngest/client";
import {
  type CsatRating,
  commentRequiredFor,
  ratingClosesTicket,
  ratingToResponse,
} from "./csat";

const COMMENT_MAX = 2000;

export type CsatTicket = {
  id: string;
  ticketNumber: string;
  status: string;
  assignedToId: string | null;
  customerId: string | null;
  customerEmail: string;
  customerName: string;
  subject: string;
};

export type RecordCsatInput = {
  ticket: CsatTicket;
  rating: CsatRating;
  comment?: string | null;
  respondent: { id: string | null; email: string; name: string };
  via: "portal" | "email";
  /** Audit actor — the customer's id (portal) or null (email link). */
  actorId: string | null;
};

export type RecordCsatResult =
  | {
      ok: true;
      newStatus: "closed" | "open" | "in_progress";
      /** True when the ticket had already moved past `resolved`, so we recorded
       *  the rating for reporting accuracy without changing state. */
      recordedOnly: boolean;
    }
  | { ok: false; reason: "already" | "not_resolved" | "comment_required" };

/**
 * THE single place that applies a customer's CSAT rating. Shared by the
 * authenticated portal action and the email-link route so the atomic
 * close/reopen guard, the append-only `ticket_reviews` record, the audit entry,
 * and the notifications all stay identical across both entry points.
 *
 * Ratings: happy/neutral close the ticket (comment optional); unhappy reopens
 * it (comment MANDATORY). `csat_response` is kept in lock-step for the existing
 * binary reports + guards.
 *
 * Customer-facing close/reopen emails are sent ONLY for the `email` entry point
 * — a portal responder is already looking at the page. Staff notifications fire
 * for both. Everything after the guarded write is best-effort.
 */
export async function recordCsatResponse(
  input: RecordCsatInput,
): Promise<RecordCsatResult> {
  const { ticket, rating, respondent, via, actorId } = input;

  const trimmedComment = (input.comment ?? "").trim().slice(0, COMMENT_MAX);
  if (commentRequiredFor(rating) && trimmedComment.length === 0) {
    return { ok: false, reason: "comment_required" };
  }

  const now = new Date();
  const response = ratingToResponse(rating);
  const closes = ratingClosesTicket(rating);

  // Snapshot the current primary technician (name survives reassignment).
  let technicianName: string | null = null;
  if (ticket.assignedToId) {
    const [tech] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, ticket.assignedToId))
      .limit(1);
    technicianName = tech?.name ?? null;
  }

  async function insertReview(tx: Tx): Promise<void> {
    await tx.insert(ticketReviews).values({
      ticketId: ticket.id,
      rating,
      comment: trimmedComment.length > 0 ? trimmedComment : null,
      technicianId: ticket.assignedToId,
      technicianName,
      respondentEmail: respondent.email.toLowerCase(),
      respondentId: respondent.id,
      submittedVia: via,
    });
  }

  // ── Ticket already moved past `resolved` — record for report accuracy
  //    without rolling the state back (mirrors the old /csat/confirm branch). ──
  if (ticket.status !== "resolved") {
    const won = await transactional(async (tx) => {
      const updated = await tx
        .update(tickets)
        .set({ csatResponse: response, csatRating: rating, csatRespondedAt: now, updatedAt: now })
        .where(and(eq(tickets.id, ticket.id), isNull(tickets.csatResponse)))
        .returning({ id: tickets.id });
      if (updated.length === 0) return false;
      await insertReview(tx);
      return true;
    });
    if (!won) return { ok: false, reason: "already" };
    await audit({
      actorId,
      action: `ticket.csat.${response}`,
      targetType: "ticket",
      targetId: ticket.ticketNumber,
      after: { csatResponse: response, rating, ticketStatus: ticket.status, source: via },
    });
    return {
      ok: true,
      newStatus: ticket.status as "closed" | "open" | "in_progress",
      recordedOnly: true,
    };
  }

  // ── Normal path: the ticket is resolved and awaiting feedback. ──
  const newStatus: "closed" | "open" | "in_progress" = closes
    ? "closed"
    : ticket.assignedToId
      ? "in_progress"
      : "open";

  const won = await transactional(async (tx) => {
    // Atomic guard: only act while the ticket is STILL resolved and unanswered.
    // The loser of a concurrent race (e.g. a link scanner prefetching two of
    // the emoji links) matches no row and bails — no double close/reopen/email.
    const updated = await tx
      .update(tickets)
      .set(
        closes
          ? {
              csatResponse: response,
              csatRating: rating,
              csatRespondedAt: now,
              status: "closed",
              closedAt: now,
              updatedAt: now,
            }
          : {
              // Reopen (unhappy): clear the ticket-level rating so the NEXT
              // resolution can be rated again — the append-only ticket_reviews
              // row (inserted below) is what preserves this unhappy rating +
              // comment in the history.
              csatResponse: null,
              csatRating: null,
              csatRespondedAt: null,
              status: newStatus,
              resolvedAt: null,
              reopenedCount: sql`${tickets.reopenedCount} + 1`,
              updatedAt: now,
            },
      )
      .where(
        and(
          eq(tickets.id, ticket.id),
          eq(tickets.status, "resolved"),
          isNull(tickets.csatResponse),
        ),
      )
      .returning({ id: tickets.id });
    if (updated.length === 0) return false;

    await insertReview(tx);

    // On a reopen, post the customer's explanation as a real thread message so
    // the assigned tech picks the ticket back up with their words in context.
    if (!closes && trimmedComment.length > 0) {
      await tx.insert(messages).values({
        ticketId: ticket.id,
        authorId: respondent.id,
        authorEmail: respondent.email.toLowerCase(),
        authorName: respondent.name,
        authorType: "customer",
        body: trimmedComment,
        bodyFormat: "text",
        channel: via === "portal" ? "portal" : "email",
      });
    }
    return true;
  });

  if (!won) return { ok: false, reason: "already" };

  await audit({
    actorId,
    action: `ticket.csat.${response}`,
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    before: { status: "resolved" },
    after: {
      status: newStatus,
      csatResponse: response,
      rating,
      source: via,
      commentLength: trimmedComment.length,
    },
  });

  const appUrl = getAppUrl();

  if (closes) {
    try {
      await dispatchTicketClosedStaff({
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        reason: "csat",
        appUrl,
      });
    } catch (err) {
      console.error("[recordCsatResponse] staff close notification failed:", err);
    }
    if (via === "email") {
      try {
        await sendEmail({
          to: ticket.customerEmail,
          template: {
            template: "ticket_closed",
            data: {
              ticketNumber: ticket.ticketNumber,
              customerName: ticket.customerName,
              subject: ticket.subject,
              reason: "csat",
              newTicketUrl: `${appUrl}/portal/submit`,
            },
          },
          ticketNumber: ticket.ticketNumber,
        });
      } catch (err) {
        console.error("[recordCsatResponse] ticket_closed email failed:", err);
      }
    }
    return { ok: true, newStatus, recordedOnly: false };
  }

  // Reopen — alert the assigned tech + Coordinators that the customer pushed
  // back, honoring each recipient's notification preferences.
  try {
    const adminTicketUrl = `${appUrl}/admin/tickets/${ticket.id}`;
    await inngest.send({
      name: "notification/dispatch",
      data: {
        type: "ticket.csat_unsatisfied",
        recipientUserIds: ticket.assignedToId ? [ticket.assignedToId] : [],
        recipientRoles: [...OVERSIGHT_ROLES],
        email: {
          template: {
            template: "csat_unsatisfied_staff",
            data: {
              ticketNumber: ticket.ticketNumber,
              subject: ticket.subject,
              customerName: ticket.customerName,
              ticketUrl: adminTicketUrl,
            },
          },
          ticketNumber: ticket.ticketNumber,
        },
        sms: {
          template: {
            template: "csat_unsatisfied_staff",
            data: { ticketNumber: ticket.ticketNumber, ticketUrl: adminTicketUrl },
          },
        },
        inApp: {
          titleArgs: { ticketNumber: ticket.ticketNumber },
          bodyArgs: { customerName: ticket.customerName },
          linkUrl: `/admin/tickets/${ticket.id}`,
        },
      },
    });
  } catch (err) {
    console.error("[recordCsatResponse] staff reopen dispatch failed:", err);
  }

  if (via === "email") {
    try {
      const trackingUrl = ticketTrackingUrl({
        appUrl,
        ticketNumber: ticket.ticketNumber,
        customerEmail: ticket.customerEmail,
        customerId: ticket.customerId,
      });
      await sendEmail({
        to: ticket.customerEmail,
        template: {
          template: "ticket_reopened",
          data: {
            ticketNumber: ticket.ticketNumber,
            customerName: ticket.customerName,
            subject: ticket.subject,
            reason: "csat_unsatisfied",
            trackingUrl,
          },
        },
        ticketNumber: ticket.ticketNumber,
        replyToTicket: true,
      });
    } catch (err) {
      console.error("[recordCsatResponse] ticket_reopened email failed:", err);
    }
  }

  return { ok: true, newStatus, recordedOnly: false };
}
