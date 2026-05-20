import { and, eq, gt } from "drizzle-orm";
import { eventType } from "inngest";
import { simpleParser } from "mailparser";
import { audit } from "@/lib/audit";
import { db, transactional } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { attachments } from "@/lib/db/schema/attachments";
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
import { matchesMagicBytes } from "@/lib/storage/magic-bytes";
import {
  isAllowedMimeType,
  MAX_FILE_BYTES,
  sanitizeFilename,
} from "@/lib/storage/mime";
import { guestTicketUrl } from "@/lib/tokens";
import { getAppUrl } from "@/lib/request";
import { getSetting } from "@/lib/settings";
import { computeDueTimesForNewTicket, type Priority } from "@/lib/sla";
import { classifyStream } from "@/lib/tickets/stream";
import {
  attachmentStorageKey,
  uploadObject,
} from "@/lib/storage/upload";
import { generateTicketNumber } from "@/lib/ticket-number";
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

    const appUrl = getAppUrl();
    const newTicketUrl = `${appUrl}/portal/submit`;

    // 2. Find ticket — if no ticket number, this is a fresh email and
    //    we open a new ticket from it (the standard "email to support"
    //    flow that every mature ticketing system supports).
    const ticketNumber = extractTicketNumber(payload);
    if (!ticketNumber) {
      const result = await step.run("create-ticket-from-email", async () =>
        createTicketFromInbound(payload, appUrl),
      );
      return result;
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

    const [insertedMsg] = await step.run("insert-message", async () =>
      db
        .insert(messages)
        .values({
          ticketId: ticket.id,
          authorEmail: payload.fromEmail,
          authorName: payload.fromName ?? payload.fromEmail,
          authorType: "customer",
          body: messageBody,
          channel: "email",
        })
        .returning({ id: messages.id }),
    );

    // 6b. Ingest attachments — only when raw MIME is supplied. We parse
    // with mailparser, then filter (allowed MIME + size + magic-byte
    // verify) and upload directly to R2. Per ARCHITECTURE §11.
    if (payload.raw) {
      await step.run("ingest-attachments", async () => {
        try {
          const parsed = await simpleParser(payload.raw!);
          const items = parsed.attachments ?? [];
          for (const a of items) {
            const declared = (a.contentType ?? "").toLowerCase();
            const fileName = a.filename ?? "attachment";
            if (!isAllowedMimeType(declared)) continue;
            const buf = a.content;
            if (!Buffer.isBuffer(buf)) continue;
            if (buf.byteLength === 0 || buf.byteLength > MAX_FILE_BYTES)
              continue;
            if (!matchesMagicBytes(declared, new Uint8Array(buf.subarray(0, 16))))
              continue;

            const sanitized = sanitizeFilename(fileName);
            const [row] = await db
              .insert(attachments)
              .values({
                ticketId: ticket.id,
                messageId: insertedMsg.id,
                uploadedById: null,
                uploadedByEmail: payload.fromEmail,
                fileName: sanitized,
                originalFileName: fileName,
                storageKey: "",
                mimeType: declared,
                sizeBytes: buf.byteLength,
                scanStatus: "pending",
              })
              .returning({ id: attachments.id });
            const storageKey = attachmentStorageKey(
              ticket.id,
              row.id,
              sanitized,
            );
            try {
              await uploadObject(
                storageKey,
                new Uint8Array(buf),
                declared,
              );
              await db
                .update(attachments)
                .set({
                  storageKey,
                  uploadConfirmedAt: new Date(),
                })
                .where(eq(attachments.id, row.id));
              await inngest.send({
                name: "attachment/uploaded",
                data: { attachmentId: row.id },
              });
            } catch (err) {
              console.error(
                "[process-inbound-email] attachment upload failed:",
                err,
              );
              await db.delete(attachments).where(eq(attachments.id, row.id));
            }
          }
        } catch (err) {
          console.error(
            "[process-inbound-email] attachment ingest failed:",
            err,
          );
        }
      });
    }

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

    // Notify the assigned tech via the dispatch fan-out.
    if (ticket.assignedToId) {
      await step.run("notify-assignee", async () => {
        try {
          const customerName = payload.fromName ?? payload.fromEmail;
          await inngest.send({
            name: "notification/dispatch",
            data: {
              type: "ticket.customer_replied",
              recipientUserIds: [ticket.assignedToId!],
              ticketId: ticket.id,
              ticketNumber: ticket.ticketNumber,
              email: {
                template: {
                  template: "ticket_reply",
                  data: {
                    ticketNumber: ticket.ticketNumber,
                    customerName,
                    subject: ticket.subject,
                    agentName: customerName,
                    body: messageBody,
                    trackingUrl: `${appUrl}/admin/tickets/${ticket.id}`,
                  },
                },
                ticketNumber: ticket.ticketNumber,
              },
              sms: {
                template: {
                  template: "customer_replied",
                  data: {
                    ticketNumber: ticket.ticketNumber,
                    ticketUrl: `${appUrl}/admin/tickets/${ticket.id}`,
                  },
                },
              },
              inApp: {
                titleArgs: { ticketNumber: ticket.ticketNumber },
                bodyArgs: { customerName },
                linkUrl: `/admin/tickets/${ticket.id}`,
              },
            },
          });
        } catch (err) {
          console.error(
            "[process-inbound-email] dispatch failed:",
            err,
          );
        }
      });
    }

    return { status: "ok", ticketNumber };
  },
);

// ── New-ticket-from-inbound-email ──────────────────────────────────────
//
// Mirrors the public-portal `createTicket` shape: generate ticket number,
// compute SLA, insert with the initial message in a transaction, then
// send a confirmation email back to the sender. Differences from portal
// submissions: no Turnstile (the mail server already authenticated the
// sender), no rate-limit-per-IP (the inbound-route handler did that),
// fixed defaults for category/priority (we can't ask the customer to
// pick), and we honor the optional sender-allowlist setting.

const DEFAULT_INBOUND_PRIORITY: Priority = "medium";
const DEFAULT_INBOUND_CATEGORY = "other";
const SUBJECT_MAX = 150;

async function createTicketFromInbound(
  payload: NormalizedInboundEmail,
  appUrl: string,
): Promise<
  | { status: "created"; ticketNumber: string }
  | { status: "blocked-allowlist" }
  | { status: "no-body" }
> {
  const fromEmail = payload.fromEmail.toLowerCase();
  const fromName = (payload.fromName ?? "").trim() || fromEmail;

  // Body must be non-trivial after stripping quoted history / signatures.
  // Without this, every "thanks!" reply with no Reply-To header would
  // open a new ticket — which would be noise, not signal.
  const stripped = stripQuotesAndSignatures(payload.text ?? "");
  const body = stripped.length > 0 ? stripped : (payload.text ?? "").trim();
  if (body.length === 0) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[process-inbound-email] empty body from ${fromEmail}, dropped`);
    }
    return { status: "no-body" };
  }

  // Look up sender. If they have a Customer account, link the ticket;
  // otherwise leave customer_id null — `claimTicketsForCustomer` will
  // bind it when they later sign up via the portal.
  const [knownUser] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.email, fromEmail))
    .limit(1);

  // Sender-allowlist gate. When enabled, only known active users can
  // submit via email. Unknown senders get a polite bounce instead of a
  // silent drop so a legit but un-onboarded user knows what happened.
  const allowlistOnly =
    (await getSetting<boolean>("inbound_sender_allowlist_only")) ?? false;
  if (allowlistOnly && !knownUser) {
    try {
      await sendEmail({
        to: payload.fromEmail,
        template: {
          template: "inbound_bounce",
          data: {
            customerName: fromName,
            newTicketUrl: `${appUrl}/portal/sign-up`,
          },
        },
      });
    } catch (err) {
      console.error(
        "[process-inbound-email] allowlist bounce email failed:",
        err,
      );
    }
    return { status: "blocked-allowlist" };
  }

  // Subject defaults — strip leading "Re:"/"Fwd:" since this is meant
  // to be a fresh ticket; trim to schema length cap.
  const rawSubject = (payload.subject ?? "").replace(/^(re|fwd?):\s*/i, "").trim();
  const subject =
    rawSubject.length > 0
      ? rawSubject.slice(0, SUBJECT_MAX)
      : "(no subject)";

  // Stream classification mirrors the public createTicket path —
  // role beats domain via `classifyStream` (a staff member emailing
  // in from a gmail address still counts as internal).
  const stream = await classifyStream(fromEmail);

  const ticketNumber = await generateTicketNumber();
  const createdAt = new Date();
  const { responseDueAt, resolutionDueAt } = await computeDueTimesForNewTicket(
    { createdAt, priority: DEFAULT_INBOUND_PRIORITY },
  );

  await transactional(async (tx) => {
    const [t] = await tx
      .insert(tickets)
      .values({
        ticketNumber,
        subject,
        description: body,
        category: DEFAULT_INBOUND_CATEGORY,
        priority: DEFAULT_INBOUND_PRIORITY,
        status: "open",
        stream,
        origin: "email",
        customerEmail: fromEmail,
        customerName: knownUser?.name ?? fromName,
        customerId: knownUser?.id ?? null,
        createdAt,
        responseDueAt,
        resolutionDueAt,
      })
      .returning({ id: tickets.id });

    await tx.insert(messages).values({
      ticketId: t.id,
      authorEmail: fromEmail,
      authorName: knownUser?.name ?? fromName,
      authorType: "customer",
      body,
      channel: "email",
    });
  });

  await audit({
    actorId: null,
    action: "ticket.create",
    targetType: "ticket",
    targetId: ticketNumber,
    after: {
      ticketNumber,
      subject,
      stream,
      origin: "email",
      knownCustomer: knownUser !== undefined,
    },
  });

  // Confirmation email — reuse the portal-style `ticket_created`
  // template so the customer sees a consistent "your ticket is AX-XYZ"
  // message regardless of which channel they came in through. Setting
  // `replyToTicket: true` makes the Reply-To header carry the per-
  // ticket address, so a customer reply continues the same ticket.
  try {
    const trackingUrl = guestTicketUrl(appUrl, ticketNumber, fromEmail);
    await sendEmail({
      to: payload.fromEmail,
      template: {
        template: "ticket_created",
        data: {
          ticketNumber,
          customerName: knownUser?.name ?? fromName,
          subject,
          trackingUrl,
        },
      },
      ticketNumber,
      replyToTicket: true,
    });
  } catch (err) {
    console.error(
      "[process-inbound-email] confirmation email failed:",
      err,
    );
  }

  return { status: "created", ticketNumber };
}
