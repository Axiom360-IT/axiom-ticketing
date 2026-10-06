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
import { withAutomationRun } from "@/lib/automations/runs";
import { inngest } from "../client";

// Customer follow-up + auto-close monitor — runs every 6 hours.
//
// When a ticket sits in `awaiting_customer_confirmation` and the customer
// hasn't replied since the agent's last message, this:
//   1. after `customer_followup.followup_days`, sends the first nudge email
//      ("reply or we'll close it on <date>") and stamps
//      `tickets.customer_followup_sent_at`; then
//   2. in daily mode, repeats that reminder roughly once a day until
//      `customer_followup.max_reminders` have gone out — after which the
//      ticket goes deliberately QUIET for the remainder of the window; then
//   3. after `customer_followup.close_days` more with still no reply,
//      auto-closes the ticket (reason `customer_no_response`) and sends the
//      normal ticket-closed notification.
//
// With followup_days=1, max_reminders=3, close_days=4 that is: reminders on
// days 1, 2 and 3, silence on day 4, closed on day 5.
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
const FALLBACK_FOLLOWUP_DAYS = 1;
const FALLBACK_CLOSE_DAYS = 4;
const FALLBACK_MAX_REMINDERS = 3;

export const customerFollowupMonitor = inngest.createFunction(
  {
    id: "customer-followup-monitor",
    triggers: cron("0 */6 * * *"),
  },
  async ({ step }) =>
    withAutomationRun("customer-followup-monitor", async () => {
    const cfg = await step.run("load-config", async () => {
      const s = await getSettings<{
        "customer_followup.enabled"?: unknown;
        "customer_followup.daily"?: unknown;
        "customer_followup.followup_days"?: unknown;
        "customer_followup.close_days"?: unknown;
        "customer_followup.max_reminders"?: unknown;
      }>([
        "customer_followup.enabled",
        "customer_followup.daily",
        "customer_followup.followup_days",
        "customer_followup.close_days",
        "customer_followup.max_reminders",
      ]);
      const enabled = s["customer_followup.enabled"];
      const daily = s["customer_followup.daily"];
      const fd = s["customer_followup.followup_days"];
      const cd = s["customer_followup.close_days"];
      const mr = s["customer_followup.max_reminders"];
      return {
        enabled: typeof enabled === "boolean" ? enabled : true,
        daily: typeof daily === "boolean" ? daily : true,
        followupDays:
          typeof fd === "number" && fd > 0 ? fd : FALLBACK_FOLLOWUP_DAYS,
        closeDays:
          typeof cd === "number" && cd > 0 ? cd : FALLBACK_CLOSE_DAYS,
        maxReminders:
          typeof mr === "number" && mr > 0 ? mr : FALLBACK_MAX_REMINDERS,
      };
    });

    if (!cfg.enabled) {
      return { skipped: "disabled" as const };
    }

    const now = new Date();
    // A ticket becomes eligible for a reminder once the agent's last message is
    // older than `followupDays`, and for auto-close once it's older than
    // `followupDays + closeDays` (both measured from the agent's message, so the
    // timing is stable whether we send one reminder or a daily series).
    const followupCutoff = now.getTime() - cfg.followupDays * DAY_MS;
    const closeCutoff =
      now.getTime() - (cfg.followupDays + cfg.closeDays) * DAY_MS;
    // Daily re-nudge threshold. 20h (not 24h) so the 6-hourly cron reliably
    // lands one reminder per calendar day without skipping.
    const RENUDGE_MS = 20 * 60 * 60 * 1000;

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
        followupCount: tickets.customerFollowupCount,
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
      // A reminder has been sent for the CURRENT agent message if the stamp
      // post-dates it; a newer agent reply makes the stamp stale and re-opens
      // the whole cycle.
      const nudgedSinceLastAgent = sentMs !== null && sentMs >= lastAtMs;
      // Re-assert atomically at write time that the customer STILL hasn't
      // replied since the agent's last message. A reply (approved OR held for
      // moderation) that lands between the candidate read and this write must
      // cancel the nudge/close — the ticket's status alone doesn't change when
      // a customer replies, so the status guard isn't enough on its own.
      const noNewCustomerReply = sql`not exists (select 1 from ${messages} m where m.ticket_id = ${t.id} and m.author_type = 'customer' and m.is_internal_note = false and m.created_at > ${new Date(lastAtMs)})`;

      // ── 1. Auto-close ───────────────────────────────────────────
      // Once at least one reminder has gone out and the full grace+close window
      // has elapsed since the agent's message, close it.
      if (nudgedSinceLastAgent && lastAtMs <= closeCutoff) {
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
        continue;
      }

      // ── 2. Nudge (first reminder, or a daily re-nudge) ──────────
      // Fire once the grace window has passed. In DAILY mode, re-fire when the
      // last reminder is > ~20h old, but only while fewer than
      // `maxReminders` have gone out for this agent message — the remaining
      // days before the close are intentionally silent. In single mode, only
      // the first one is ever sent.
      // A stale stamp means a new series, so the stored count doesn't apply.
      const remindersSoFar = nudgedSinceLastAgent ? (t.followupCount ?? 0) : 0;
      const dueForNudge =
        lastAtMs <= followupCutoff &&
        (!nudgedSinceLastAgent ||
          (cfg.daily &&
            sentMs !== null &&
            sentMs <= now.getTime() - RENUDGE_MS &&
            remindersSoFar < cfg.maxReminders));
      if (!dueForNudge) continue;

      // Guards that let the atomic claim succeed: no stamp yet, a stale stamp
      // (older than the agent's message), or — in daily mode — a stamp older
      // than the re-nudge window. Overlapping runs still can't double-send.
      const claimGuards = [
        isNull(tickets.customerFollowupSentAt),
        lt(tickets.customerFollowupSentAt, new Date(lastAtMs)),
      ];
      if (cfg.daily) {
        // Re-nudge only while under the cap — checked in the same atomic
        // claim so two overlapping runs can't push the series past it.
        const capGuard = and(
          lt(
            tickets.customerFollowupSentAt,
            new Date(now.getTime() - RENUDGE_MS),
          ),
          lt(tickets.customerFollowupCount, cfg.maxReminders),
        );
        if (capGuard) claimGuards.push(capGuard);
      }

      const claimed = await step.run(`followup-claim-${t.id}`, async () => {
        const rows = await db
          .update(tickets)
          .set({
            customerFollowupSentAt: now,
            // 1 when this starts a new series (no stamp, or one older than the
            // agent's message), otherwise one more than what's stored.
            customerFollowupCount: sql`case when ${tickets.customerFollowupSentAt} is null or ${tickets.customerFollowupSentAt} < ${new Date(lastAtMs)} then 1 else ${tickets.customerFollowupCount} + 1 end`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(tickets.id, t.id),
              eq(tickets.status, "awaiting_customer_confirmation"),
              or(...claimGuards),
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
          after: {
            followupSentAt: now.toISOString(),
            reminder: `${remindersSoFar + 1}/${cfg.maxReminders}`,
          },
        });
        return true;
      });
      if (claimed) {
        // Email in its own step so a send failure retries just the email.
        // The close instant is fixed to the agent's message — NOT to when this
        // reminder happens to go out. Deriving it from `now` made every
        // reminder after the first quote a date later than the actual close.
        const closeAt = new Date(
          lastAtMs + (cfg.followupDays + cfg.closeDays) * DAY_MS,
        );
        await step.run(`followup-email-${t.id}`, async () => {
          await sendFollowupEmail(t, closeAt);
        });
        nudged++;
      }
    }

    return { candidates: candidates.length, nudged, closed };
    }),
);

type Candidate = {
  id: string;
  ticketNumber: string;
  subject: string;
  customerEmail: string;
  customerName: string;
  customerId: string | null;
};

async function sendFollowupEmail(t: Candidate, closeAt: Date): Promise<void> {
  const appUrl = getAppUrl();
  const closeDate = closeAt.toLocaleDateString("en-GB", {
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
