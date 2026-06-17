import { and, eq, isNull, lte, ne, or, sql } from "drizzle-orm";
import { cron } from "inngest";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema/tickets";
import { getAppUrl } from "@/lib/request";
import { getSettings } from "@/lib/settings";
import { inngest } from "../client";

// Unassigned-ticket monitor — runs every 5 minutes.
//
// Emails the admin roles (Coordinator / IT Director / Super Admin) about any
// open ticket that has sat with no technician assigned past the configured
// threshold, so nothing is left to rot in the queue. All behaviour is
// settings-driven (Settings → Tickets → "Unassigned-ticket alerts"):
//
//   - unassigned_alert.enabled          (bool)   master on/off
//   - unassigned_alert.threshold_minutes (int)   age before the first alert
//   - unassigned_alert.repeat_minutes    (int)   re-nag cadence; 0 = once
//
// Idempotency + re-nag: `tickets.unassigned_reminder_at` stamps the last
// alert. The candidate query and the stamping UPDATE both re-check the
// "never alerted OR last alerted before the repeat cutoff" predicate, so
// overlapping cron runs can't double-send. The threshold is wall-clock (not
// business hours) — an unowned ticket is a problem whenever it arrives.

const TICKET_BATCH_LIMIT = 500;
const FALLBACK_THRESHOLD_MINUTES = 120;

export const unassignedMonitor = inngest.createFunction(
  {
    id: "unassigned-ticket-monitor",
    triggers: cron("*/5 * * * *"),
  },
  async ({ step }) => {
    const cfg = await step.run("load-config", async () => {
      const s = await getSettings<{
        "unassigned_alert.enabled"?: unknown;
        "unassigned_alert.threshold_minutes"?: unknown;
        "unassigned_alert.repeat_minutes"?: unknown;
      }>([
        "unassigned_alert.enabled",
        "unassigned_alert.threshold_minutes",
        "unassigned_alert.repeat_minutes",
      ]);
      const enabled = s["unassigned_alert.enabled"];
      const threshold = s["unassigned_alert.threshold_minutes"];
      const repeat = s["unassigned_alert.repeat_minutes"];
      return {
        enabled: typeof enabled === "boolean" ? enabled : true,
        thresholdMinutes:
          typeof threshold === "number" && threshold > 0
            ? threshold
            : FALLBACK_THRESHOLD_MINUTES,
        repeatMinutes: typeof repeat === "number" && repeat > 0 ? repeat : 0,
      };
    });

    if (!cfg.enabled) {
      return { skipped: "disabled" as const };
    }

    const now = new Date();
    const thresholdCutoff = new Date(
      now.getTime() - cfg.thresholdMinutes * 60_000,
    );
    const repeatCutoff =
      cfg.repeatMinutes > 0
        ? new Date(now.getTime() - cfg.repeatMinutes * 60_000)
        : null;

    // The reminder-eligibility predicate, reused in the candidate read and the
    // atomic stamping UPDATE: never reminded, or (repeat on) reminded before
    // the repeat cutoff.
    const eligibleAgain = or(
      isNull(tickets.unassignedReminderAt),
      repeatCutoff
        ? lte(tickets.unassignedReminderAt, repeatCutoff)
        : sql`false`,
    );

    // Read candidates OUTSIDE step.run — Dates survive as Dates (Inngest's
    // step memoization would otherwise JSON-stringify them).
    const candidates = await db
      .select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        subject: tickets.subject,
      })
      .from(tickets)
      .where(
        and(
          ne(tickets.status, "resolved"),
          ne(tickets.status, "closed"),
          isNull(tickets.assignedToId),
          lte(tickets.createdAt, thresholdCutoff),
          eligibleAgain,
        ),
      )
      .limit(TICKET_BATCH_LIMIT);

    let alerted = 0;
    for (const t of candidates) {
      await step.run(`unassigned-${t.id}`, async () => {
        // Atomically claim the alert: stamp only if the ticket is STILL
        // unassigned and STILL eligible. A concurrent run that already stamped
        // it to `now` fails this WHERE and sends nothing.
        const claimed = await db
          .update(tickets)
          .set({ unassignedReminderAt: now, updatedAt: sql`now()` })
          .where(
            and(
              eq(tickets.id, t.id),
              isNull(tickets.assignedToId),
              eligibleAgain,
            ),
          )
          .returning({ id: tickets.id });
        if (claimed.length === 0) return;
        await dispatch(t);
      });
      alerted++;
    }

    return { candidates: candidates.length, alerted };
  },
);

async function dispatch(t: {
  id: string;
  ticketNumber: string;
  subject: string;
}): Promise<void> {
  const appUrl = getAppUrl();
  const adminUrl = `${appUrl}/admin/tickets/${t.id}`;
  try {
    await inngest.send({
      name: "notification/dispatch",
      data: {
        type: "ticket.unassigned_reminder",
        recipientRoles: ["Coordinator", "IT Director", "Super Admin"],
        email: {
          template: {
            template: "ticket_unassigned_staff",
            data: {
              ticketNumber: t.ticketNumber,
              subject: t.subject,
              adminUrl,
            },
          },
          ticketNumber: t.ticketNumber,
        },
        inApp: {
          titleArgs: { ticketNumber: t.ticketNumber },
          bodyArgs: { subject: t.subject },
          linkUrl: `/admin/tickets/${t.id}`,
        },
      },
    });
  } catch (err) {
    console.error("[unassigned-monitor] dispatch failed:", err);
  }
}
