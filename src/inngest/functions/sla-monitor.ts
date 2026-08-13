import { and, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { cron } from "inngest";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema/tickets";
import { getAppUrl } from "@/lib/request";
import { getSetting } from "@/lib/settings";
import { inngest } from "../client";

// Fallback breach recipients when the setting isn't configured (req 6.3).
const DEFAULT_BREACH_ROLES = ["Super Admin", "IT Director", "Coordinator"];
// Fallback warning (50%/80%, not-yet-breached) recipients — same default
// roles as breach, so management sees an SLA risk approaching, not just
// after it's already blown.
const DEFAULT_WARNING_ROLES = ["Super Admin", "IT Director", "Coordinator"];

// SLA monitor — runs every 20 minutes. (Widened from 5 min to keep the
// database idle enough between runs for Neon's free compute tier; SLA
// windows are measured in hours, so a 20-minute detection granularity is
// immaterial. The unassigned-ticket monitor runs on the same cadence.)
//
// For every ticket that's still in flight (status NOT IN
// ('resolved','closed')) we check elapsed time against the response and
// resolution due times and emit a notification + audit on three
// transitions. Every tier notifies the assignee (if any) PLUS the
// admin-configured staff roles for that tier (`sla.warning_notify_roles` for
// the two warnings, `sla.breach_notify_roles` for the breach — both default
// to Super Admin/IT Director/Coordinator when unset):
//
//   - 50% elapsed → notification (in-app only)
//   - 80% elapsed → notification (SMS + in-app)
//   - 100%+ elapsed → breach: notification (email + SMS + in-app) + audit
//
// Idempotency: each ticket has sla_warning_50_at, sla_warning_80_at,
// sla_breached_at columns. We only fire when the relevant column is
// still NULL — re-runs of the cron find nothing to do.

const TICKET_BATCH_LIMIT = 500;

export const slaMonitor = inngest.createFunction(
  {
    id: "sla-monitor",
    triggers: cron("*/20 * * * *"),
  },
  async ({ step }) => {
    const now = new Date();
    const t50 = now;
    const t80 = now;
    const tBreach = now;

    // Configurable breach recipients + repeat-escalation cadence (read once per
    // run). `repeatHours` of 0 disables the re-nag entirely.
    const breachNotifyRolesRaw = await getSetting<string[]>("sla.breach_notify_roles");
    const breachNotifyRoles =
      breachNotifyRolesRaw && breachNotifyRolesRaw.length > 0
        ? breachNotifyRolesRaw
        : DEFAULT_BREACH_ROLES;
    const repeatHours = (await getSetting<number>("sla.breach_repeat_hours")) ?? 0;

    // Configurable 50%/80% warning recipients — independent picker from the
    // breach one (an admin may want a wider or narrower audience before
    // things are actually late).
    const warningNotifyRolesRaw = await getSetting<string[]>("sla.warning_notify_roles");
    const warningNotifyRoles =
      warningNotifyRolesRaw && warningNotifyRolesRaw.length > 0
        ? warningNotifyRolesRaw
        : DEFAULT_WARNING_ROLES;

    // Pull only tickets that COULD transition: still in flight AND
    // missing at least one of the three idempotency stamps. The read
    // is idempotent and cheap, so it runs outside step.run — that
    // avoids Inngest's JSON memoization turning Date columns into
    // strings on retry.
    const inFlight = await db
      .select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        assignedToId: tickets.assignedToId,
        createdAt: tickets.createdAt,
        responseDueAt: tickets.responseDueAt,
        resolutionDueAt: tickets.resolutionDueAt,
        firstResponseAt: tickets.firstResponseAt,
        slaWarning50At: tickets.slaWarning50At,
        slaWarning80At: tickets.slaWarning80At,
        slaBreachedAt: tickets.slaBreachedAt,
        slaBreachRemindedAt: tickets.slaBreachRemindedAt,
      })
      .from(tickets)
      .where(
        and(
          ne(tickets.status, "resolved"),
          ne(tickets.status, "closed"),
          // Skip tickets whose SLA clock is paused (Awaiting customer /
          // On hold) — no warnings or breaches fire while paused; the
          // shifted due dates resume the countdown on unpause.
          isNull(tickets.slaPausedAt),
          or(
            and(isNotNull(tickets.responseDueAt), isNull(tickets.firstResponseAt)),
            isNotNull(tickets.resolutionDueAt),
          ),
        ),
      )
      .limit(TICKET_BATCH_LIMIT);

    const summary = {
      warned50: 0,
      warned80: 0,
      breached: 0,
      breachReminders: 0,
      checked: inFlight.length,
    };

    for (const t of inFlight) {
      // Pick the most-pressing target. We prefer the response SLA until
      // the agent has replied (firstResponseAt set), then resolution.
      const target =
        !t.firstResponseAt && t.responseDueAt
          ? { kind: "response" as const, dueAt: t.responseDueAt }
          : t.resolutionDueAt
            ? { kind: "resolution" as const, dueAt: t.resolutionDueAt }
            : null;
      if (!target) continue;

      const total = target.dueAt.getTime() - t.createdAt.getTime();
      if (total <= 0) continue;
      const elapsed = now.getTime() - t.createdAt.getTime();
      const pct = elapsed / total;

      // 50% — only fire when warning_50_at is null AND we're past the threshold.
      if (pct >= 0.5 && !t.slaWarning50At) {
        await step.run(`warn50-${t.id}`, async () => {
          await db
            .update(tickets)
            .set({ slaWarning50At: t50, updatedAt: sql`now()` })
            .where(and(eq(tickets.id, t.id), isNull(tickets.slaWarning50At)));
          await dispatch(t, target.kind, "sla.warning_50", warningNotifyRoles);
        });
        summary.warned50++;
      }

      if (pct >= 0.8 && !t.slaWarning80At) {
        await step.run(`warn80-${t.id}`, async () => {
          await db
            .update(tickets)
            .set({ slaWarning80At: t80, updatedAt: sql`now()` })
            .where(and(eq(tickets.id, t.id), isNull(tickets.slaWarning80At)));
          await dispatch(t, target.kind, "sla.warning_80", warningNotifyRoles);
        });
        summary.warned80++;
      }

      if (pct >= 1 && !t.slaBreachedAt) {
        await step.run(`breach-${t.id}`, async () => {
          await db
            .update(tickets)
            .set({ slaBreachedAt: tBreach, updatedAt: sql`now()` })
            .where(and(eq(tickets.id, t.id), isNull(tickets.slaBreachedAt)));
          await audit({
            actorId: null,
            action: "ticket.sla_breach",
            targetType: "ticket",
            targetId: t.ticketNumber,
            after: {
              kind: target.kind,
              dueAt: target.dueAt.toISOString(),
              breachedAt: tBreach.toISOString(),
            },
          });
          await dispatch(t, target.kind, "sla.breached", breachNotifyRoles);
        });
        summary.breached++;
      } else if (
        // Repeat escalation — re-nag the breach recipients while an already-
        // breached ticket is STILL unassigned and in flight. Fires every
        // `repeatHours` since the last reminder (or the breach itself).
        // Assigning the ticket (or resolving it) ends the nagging. Skipped
        // entirely when repeatHours is 0.
        repeatHours > 0 &&
        t.slaBreachedAt &&
        !t.assignedToId
      ) {
        const lastPing = t.slaBreachRemindedAt ?? t.slaBreachedAt;
        if (now.getTime() - lastPing.getTime() >= repeatHours * 3_600_000) {
          await step.run(`breach-repeat-${t.id}`, async () => {
            await db
              .update(tickets)
              .set({ slaBreachRemindedAt: now, updatedAt: sql`now()` })
              .where(eq(tickets.id, t.id));
            await dispatch(t, target.kind, "sla.breached", breachNotifyRoles);
          });
          summary.breachReminders++;
        }
      }
    }

    return summary;
  },
);

async function dispatch(
  t: { id: string; ticketNumber: string; assignedToId: string | null },
  kind: "response" | "resolution",
  type: "sla.warning_50" | "sla.warning_80" | "sla.breached",
  notifyRoles: string[],
): Promise<void> {
  // Every SLA notification (50%/80% warning or breach) goes to the SAME
  // two audiences: the ticket's assignee (always, automatically — there's
  // nothing to configure, whoever owns it gets it) PLUS whichever staff
  // roles the admin picked for that tier (`sla.warning_notify_roles` for
  // 50%/80%, `sla.breach_notify_roles` for the breach — two independent
  // pickers so, e.g., a wider audience can be configured once it's actually
  // late). `notifyRoles` already carries its tier's configured-or-default
  // list in from the caller.
  //
  // Channels step up with severity: 50% is in-app only (low-noise heads-up),
  // 80% adds SMS (approaching breach), and a BREACH adds email on top of
  // both — the highest-visibility event, so nobody who could act on a missed
  // deadline is left with only a bell icon.
  const appUrl = getAppUrl();
  const ticketUrl = `${appUrl}/admin/tickets/${t.id}`;
  const isBreach = type === "sla.breached";

  const recipientRoles = notifyRoles.length > 0 ? notifyRoles : undefined;
  const recipientUserIds = t.assignedToId ? [t.assignedToId] : undefined;

  const wantsSms = isBreach || type === "sla.warning_80";
  const smsTemplate =
    type === "sla.warning_80" ? "sla_warning_80" : "sla_breached";

  try {
    await inngest.send({
      name: "notification/dispatch",
      data: {
        type,
        recipientUserIds,
        recipientRoles,
        ...(isBreach
          ? {
              email: {
                template: {
                  template: "sla_breached_staff",
                  data: {
                    ticketNumber: t.ticketNumber,
                    kind,
                    adminUrl: ticketUrl,
                  },
                },
                ticketNumber: t.ticketNumber,
              },
            }
          : {}),
        ...(wantsSms
          ? {
              sms: {
                template: {
                  template: smsTemplate,
                  data: { ticketNumber: t.ticketNumber, ticketUrl },
                },
              },
            }
          : {}),
        inApp: {
          titleArgs: { ticketNumber: t.ticketNumber },
          bodyArgs: { kind },
          linkUrl: `/admin/tickets/${t.id}`,
        },
      },
    });
  } catch (err) {
    console.error(`[sla-monitor] dispatch ${type} failed:`, err);
  }
}
