import { and, eq, gt } from "drizzle-orm";
import { eventType } from "inngest";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { messages } from "@/lib/db/schema/messages";
import { tickets } from "@/lib/db/schema/tickets";
import { sendEmail } from "@/lib/email/send";
import {
  shouldAcceptInbound,
  stripQuotesAndSignatures,
} from "@/lib/email/inbound-filter";
import {
  extractTicketNumber,
  type NormalizedInboundEmail,
} from "@/lib/email/inbound-payload";
import { inngest } from "../client";

// Inbound email processor. Runs on every `email/inbound.received` event
// emitted by `app/api/email/inbound/route.ts`. Decisions in order:
//   1. shouldAcceptInbound() — drop OOO/bounce/list mail/empty bodies
//   2. extract ticket number — drop with `inbound_bounce` reply if none
//   3. look up ticket — drop with `inbound_bounce` reply if not found
//   4. closed ticket — drop with `inbound_closed_ticket` reply
//   5. loop detection — >5 from same sender on same ticket in 5min → drop
//   6. insert customer message, notify assignee
//
// Any rejected email returns successfully so Inngest doesn't retry.

const LOOP_WINDOW_MS = 5 * 60 * 1000;
const LOOP_THRESHOLD = 5;

type EventData = {
  payload: NormalizedInboundEmail;
  eventId: string;
};

export const processInboundEmail = inngest.createFunction(
  {
    id: "process-inbound-email",
    retries: 2,
    triggers: eventType("email/inbound.received"),
  },
  async ({ event, step }) => {
    const { payload, eventId } = event.data as EventData;

    // 1. Filter
    const decision = shouldAcceptInbound({
      headers: new Map(Object.entries(payload.headers)),
      subject: payload.subject,
      text: payload.text,
    });
    if (!decision.accept) {
      console.info(
        `[process-inbound-email] dropped (${decision.reason}) eventId=${eventId} from=${payload.fromEmail}`,
      );
      return { status: "dropped", reason: decision.reason };
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const newTicketUrl = `${appUrl}/portal/submit`;

    // 2. Find ticket
    const ticketNumber = extractTicketNumber(payload);
    if (!ticketNumber) {
      await step.run("send-bounce-no-ticket", async () => {
        try {
          await sendEmail({
            to: payload.fromEmail,
            template: {
              template: "inbound_bounce",
              data: {
                customerName: payload.fromName ?? payload.fromEmail,
                newTicketUrl,
              },
            },
          });
        } catch (err) {
          console.error("[process-inbound-email] bounce email failed:", err);
        }
      });
      return { status: "no-ticket-number" };
    }

    // 3. Look up
    const [ticket] = await step.run("load-ticket", async () =>
      db
        .select({
          id: tickets.id,
          ticketNumber: tickets.ticketNumber,
          status: tickets.status,
          subject: tickets.subject,
          customerEmail: tickets.customerEmail,
          assignedToId: tickets.assignedToId,
        })
        .from(tickets)
        .where(eq(tickets.ticketNumber, ticketNumber))
        .limit(1),
    );

    if (!ticket) {
      await step.run("send-bounce-not-found", async () => {
        try {
          await sendEmail({
            to: payload.fromEmail,
            template: {
              template: "inbound_bounce",
              data: {
                customerName: payload.fromName ?? payload.fromEmail,
                newTicketUrl,
              },
            },
          });
        } catch (err) {
          console.error(
            "[process-inbound-email] bounce (not-found) email failed:",
            err,
          );
        }
      });
      return { status: "ticket-not-found", ticketNumber };
    }

    // 4. Closed
    if (ticket.status === "closed") {
      await step.run("send-closed-reply", async () => {
        try {
          await sendEmail({
            to: payload.fromEmail,
            template: {
              template: "inbound_closed_ticket",
              data: {
                customerName: payload.fromName ?? payload.fromEmail,
                ticketNumber: ticket.ticketNumber,
                newTicketUrl,
              },
            },
            ticketNumber: ticket.ticketNumber,
          });
        } catch (err) {
          console.error(
            "[process-inbound-email] closed-ticket email failed:",
            err,
          );
        }
      });
      return { status: "ticket-closed", ticketNumber };
    }

    // 5. Loop detection — same sender, same ticket, > threshold in window.
    const since = new Date(Date.now() - LOOP_WINDOW_MS);
    const recent = await step.run("count-recent-from-sender", async () =>
      db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.ticketId, ticket.id),
            eq(messages.authorEmail, payload.fromEmail),
            gt(messages.createdAt, since),
          ),
        ),
    );
    if (recent.length >= LOOP_THRESHOLD) {
      console.warn(
        `[process-inbound-email] loop detected: ${payload.fromEmail} on ${ticketNumber} (${recent.length} in ${LOOP_WINDOW_MS}ms)`,
      );
      return { status: "loop-detected", ticketNumber };
    }

    // 6. Insert message
    const stripped = stripQuotesAndSignatures(payload.text ?? "");
    const messageBody = stripped.length > 0 ? stripped : (payload.text ?? "");

    await step.run("insert-message", async () =>
      db.insert(messages).values({
        ticketId: ticket.id,
        authorEmail: payload.fromEmail,
        authorName: payload.fromName ?? payload.fromEmail,
        authorType: "customer",
        body: messageBody,
        channel: "email",
      }),
    );

    await step.run("touch-ticket", async () =>
      db
        .update(tickets)
        .set({ updatedAt: new Date() })
        .where(eq(tickets.id, ticket.id)),
    );

    await audit({
      actorId: null,
      action: "ticket.inbound_email",
      targetType: "ticket",
      targetId: ticket.ticketNumber,
      after: { from: payload.fromEmail, length: messageBody.length },
    });

    // Notify the assigned tech (best-effort). Customer never gets a
    // confirmation here — this is just an inbound capture.
    if (ticket.assignedToId) {
      await step.run("notify-assignee", async () => {
        try {
          const [tech] = await db
            .select({ name: users.name, email: users.email })
            .from(users)
            .where(eq(users.id, ticket.assignedToId!))
            .limit(1);
          if (!tech) return;
          await sendEmail({
            to: tech.email,
            template: {
              template: "ticket_reply",
              data: {
                ticketNumber: ticket.ticketNumber,
                customerName: payload.fromName ?? payload.fromEmail,
                subject: ticket.subject,
                agentName: payload.fromName ?? payload.fromEmail,
                body: messageBody,
                trackingUrl: `${appUrl}/admin/tickets/${ticket.id}`,
              },
            },
            ticketNumber: ticket.ticketNumber,
          });
        } catch (err) {
          console.error(
            "[process-inbound-email] assignee notification failed:",
            err,
          );
        }
      });
    }

    return { status: "ok", ticketNumber };
  },
);
