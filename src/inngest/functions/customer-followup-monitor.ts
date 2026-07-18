import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { cron } from "inngest";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { messages } from "@/lib/db/schema/messages";
import { tickets } from "@/lib/db/schema/tickets";
import { sendEmail } from "@/lib/email/send";
import { dispatchTicketClosedStaff } from "@/lib/notifications/dispatch-ticket-closed-staff";
import { getAppUrl } from "@/lib/request";
import { getSettings } from "@/lib/settings";
import { ticketTrackingUrl } from "@/lib/tokens";
import { inngest } from "../client";

// Customer follow-up + auto-close monitor — runs every 6 hours.
//
// When a ticket sits in `awaiting_customer_confirmation` and the customer
// hasn't replied since the agent's last message, this:
//   1. after `customer_followup.followup_days`, sends a ONE-TIME nudge email
//      ("reply or we'll close it on <date>") and stamps
//      `tickets.customer_followup_sent_at`; then
//   2. after `customer_followup.close_days` more with still no reply,
//      auto-closes the ticket (reason `customer_no_response`) and sends the
//      normal ticket-closed notification.
//
// The "clock" is the LATEST customer-visible message from the agent (not a
// status-change timestamp), so a fresh agent reply automatically re-opens the
// window: `customer_followup_sent_at < last agent message` marks the stamp
// stale, no separate reset needed. A customer reply makes the latest author
// `customer`, which drops the ticket from the candidate set entirely.
//
// All behaviour is settings-driven (Settings → Tickets → "Customer follow-up").

const DAY_MS = 24 * 60 * 60 * 1000;
const TICKET_BATCH_LIMIT = 500;
const FALLBACK_FOLLOWUP_DAYS = 3;
const FALLBACK_CLOSE_DAYS = 4;

export const customerFollowupMonitor = inngest.createFunction(
  {
    id: "customer-followup-monitor",
    triggers: cron("0 */6 * * *"),
  },
  async ({ step }) => {
    const cfg = await step.run("load-config", async () => {
      const s = await getSettings<{
        "customer_followup.enabled"?: unknown;
        "customer_followup.followup_days"?: unknown;
        "customer_followup.close_days"?: unknown;
      }>([
        "customer_followup.enabled",
        "customer_followup.followup_days",
        "customer_followup.close_days",
      ]);
      const enabled = s["customer_followup.enabled"];
      const fd = s["customer_followup.followup_days"];
      const cd = s["customer_followup.close_days"];
      return {
        enabled: typeof enabled === "boolean" ? enabled : true,
        followupDays:
          typeof fd === "number" && fd > 0 ? fd : FALLBACK_FOLLOWUP_DAYS,
        closeDays:
          typeof cd === "number" && cd > 0 ? cd : FALLBACK_CLOSE_DAYS,
      };
    });

    if (!cfg.enabled) {
      return { skipped: "disabled" as const };
    }

    const now = new Date();
    const followupCutoff = now.getTime() - cfg.followupDays * DAY_MS;
    const closeCutoff = now.getTime() - cfg.closeDays * DAY_MS;

    // Latest customer-VISIBLE message (excludes internal notes + held inbound):
    // its author tells us whose turn it is, its time is the follow-up clock.
    const lastAuthorSql = sql<string | null>`(select m.author_type from ${messages} m where m.ticket_id = "tickets"."id" and m.is_internal_note = false and m.moderation_status = 'approved' order by m.created_at desc limit 1)`;
    const lastAtSql = sql<string | Date | null>`(select m.created_at from ${messages} m where m.ticket_id = "tickets"."id" and m.is_internal_note = false and m.moderation_status = 'approved' order by m.created_at desc limit 1)`;

    // Read candidates OUTSIDE step.run — Dates survive as Dates (Inngest's step
    // memoization would otherwise JSON-stringify them).
    const candidates = await db
      .select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        subject: tickets.subject,
        customerEmail: tickets.customerEmail,
        customerName: tickets.customerName,
        customerId: tickets.customerId,
        followupSentAt: tickets.customerFollowupSentAt,
        lastAuthor: lastAuthorSql,
        lastAtRaw: lastAtSql,
      })
      .from(tickets)
      .where(
        and(
          eq(tickets.status, "awaiting_customer_confirmation"),
          isNull(tickets.deletedAt),
        ),
      )
      .orderBy(tickets.createdAt)
      .limit(TICKET_BATCH_LIMIT);

    let nudged = 0;
    let closed = 0;

    for (const t of candidates) {
      // Only when the AGENT spoke last (customer owes a reply). If the latest
      // visible message is the customer's — or there's none — skip.
      if (t.lastAuthor !== "agent" || !t.lastAtRaw) continue;
      const lastAtMs = new Date(t.lastAtRaw as string | Date).getTime();
      const sentMs = t.followupSentAt ? t.followupSentAt.getTime() : null;
      // The stamp is "current" only if it post-dates the agent's last message;
      // a newer agent reply makes it stale and re-opens the nudge window.
      const nudgeCurrent = sentMs !== null && sentMs >= lastAtMs;
      // Re-assert atomically at write time that the customer STILL hasn't
      // replied since the agent's last message. A reply (approved OR held for
      // moderation) that lands between the candidate read and this write must
      // cancel the nudge/close — the ticket's status alone doesn't change when
      // a customer replies, so the status guard isn't enough on its own.
      const noNewCustomerReply = sql`not exists (select 1 from ${messages} m where m.ticket_id = ${t.id} and m.author_type = 'customer' and m.is_internal_note = false and m.created_at > ${new Date(lastAtMs)})`;

      // ── 1. Nudge ────────────────────────────────────────────────
      if (!nudgeCurrent && lastAtMs <= followupCutoff) {
        const claimed = await step.run(`followup-claim-${t.id}`, async () => {
          // Stamp only if STILL awaiting and the stamp is STILL stale, so
          // overlapping runs can't double-nudge.
          const rows = await db
            .update(tickets)
            .set({ customerFollowupSentAt: now, updatedAt: sql`now()` })
            .where(
              and(
                eq(tickets.id, t.id),
                eq(tickets.status, "awaiting_customer_confirmation"),
                or(
                  isNull(tickets.customerFollowupSentAt),
                  lt(tickets.customerFollowupSentAt, new Date(lastAtMs)),
                ),
                noNewCustomerReply,
              ),
            )
            .returning({ id: tickets.id });
          if (rows.length === 0) return false;
          await audit({
            actorId: null,
            action: "ticket.customer_followup",
            targetType: "ticket",
            targetId: t.ticketNumber,
            after: { followupSentAt: now.toISOString() },
          });
          return true;
        });
        if (claimed) {
          // Email in its own step so a send failure retries just the email.
          await step.run(`followup-email-${t.id}`, async () => {
            await sendFollowupEmail(t, now, cfg.closeDays);
          });
          nudged++;
        }
        continue;
      }

      // ── 2. Auto-close ───────────────────────────────────────────
      if (nudgeCurrent && sentMs !== null && sentMs <= closeCutoff) {
        const didClose = await step.run(`followup-close-${t.id}`, async () => {
          const rows = await db
            .update(tickets)
            .set({
              status: "closed",
              closedAt: sql`now()`,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(tickets.id, t.id),
                eq(tickets.status, "awaiting_customer_confirmation"),
                noNewCustomerReply,
              ),
            )
            .returning({ id: tickets.id });
          if (rows.length === 0) return false;
          await audit({
            actorId: null,
            action: "ticket.auto_close",
            targetType: "ticket",
            targetId: t.ticketNumber,
            before: { status: "awaiting_customer_confirmation" },
            after: { status: "closed", reason: "customer_no_response" },
          });
          return true;
        });
        if (didClose) {
          await step.run(`followup-close-notify-${t.id}`, async () => {
            await notifyClosed(t);
          });
          closed++;
        }
      }
    }

    return { candidates: candidates.length, nudged, closed };
  },
);

type Candidate = {
  id: string;
  ticketNumber: string;
  subject: string;
  customerEmail: string;
  customerName: string;
  customerId: string | null;
};

async function sendFollowupEmail(
  t: Candidate,
  now: Date,
  closeDays: number,
): Promise<void> {
  const appUrl = getAppUrl();
  const closeDate = new Date(
    now.getTime() + closeDays * DAY_MS,
  ).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  // Let a send failure THROW so Inngest retries just this step; the memoized
  // stamp step won't re-run, so there's no double-nudge. Silently swallowing
  // would drop the "reply or we'll close it" warning yet still auto-close later.
  await sendEmail({
    to: t.customerEmail,
    template: {
      template: "customer_followup",
      data: {
        ticketNumber: t.ticketNumber,
        customerName: t.customerName,
        subject: t.subject,
        ticketUrl: ticketTrackingUrl({
          appUrl,
          ticketNumber: t.ticketNumber,
          customerEmail: t.customerEmail,
          customerId: t.customerId,
        }),
        closeDate,
      },
    },
    ticketNumber: t.ticketNumber,
  });
}

// Reuses the standard ticket-closed notifications (customer + staff), matching
// the resolved auto-close path: dispatch for registered customers (honors their
// email/SMS/bell prefs), direct email for guests, plus the staff oversight ping.
async function notifyClosed(t: Candidate): Promise<void> {
  const appUrl = getAppUrl();
  try {
    if (t.customerId) {
      await inngest.send({
        name: "notification/dispatch",
        data: {
          type: "ticket.closed",
          recipientUserIds: [t.customerId],
          ticketId: t.id,
          ticketNumber: t.ticketNumber,
          email: {
            template: {
              template: "ticket_closed",
              data: {
                ticketNumber: t.ticketNumber,
                customerName: t.customerName,
                subject: t.subject,
                reason: "auto",
                newTicketUrl: `${appUrl}/portal/submit`,
              },
            },
            ticketNumber: t.ticketNumber,
          },
          sms: {
            template: {
              template: "ticket_closed",
              data: {
                ticketNumber: t.ticketNumber,
                ticketUrl: `${appUrl}/portal/tickets/${t.ticketNumber}`,
              },
            },
          },
          inApp: {
            titleArgs: { ticketNumber: t.ticketNumber },
            bodyArgs: {
              reason: "Auto-closed after no reply to our follow-up.",
            },
            linkUrl: `/portal/tickets/${t.ticketNumber}`,
          },
        },
      });
    } else {
      await sendEmail({
        to: t.customerEmail,
        template: {
          template: "ticket_closed",
          data: {
            ticketNumber: t.ticketNumber,
            customerName: t.customerName,
            subject: t.subject,
            reason: "auto",
            newTicketUrl: `${appUrl}/portal/submit`,
          },
        },
        ticketNumber: t.ticketNumber,
      });
    }
  } catch (err) {
    console.error(
      `[customer-followup-monitor] close notify failed for ${t.ticketNumber}:`,
      err,
    );
  }

  try {
    await dispatchTicketClosedStaff({
      ticketId: t.id,
      ticketNumber: t.ticketNumber,
      subject: t.subject,
      reason: "auto",
      appUrl,
    });
  } catch (err) {
    console.error(
      `[customer-followup-monitor] staff notify failed for ${t.ticketNumber}:`,
      err,
    );
  }
}
