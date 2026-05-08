import { and, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { cron } from "inngest";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { tickets } from "@/lib/db/schema/tickets";
import { sendSms } from "@/lib/sms/send";
import { inngest } from "../client";

// SLA monitor — runs every 5 minutes per ARCHITECTURE §27.
//
// For every ticket that's still in flight (status NOT IN
// ('resolved','closed')) we check elapsed time against the response and
// resolution due times and emit a notification + audit on three
// transitions:
//
//   - 50% elapsed → notification only (low-noise heads-up)
//   - 80% elapsed → notification (in M11 this fans out to email + SMS)
//   - 100%+ elapsed → breach: notification + audit
//
// Idempotency: each ticket has sla_warning_50_at, sla_warning_80_at,
// sla_breached_at columns. We only fire when the relevant column is
// still NULL — re-runs of the cron find nothing to do.
//
// Why two thresholds? Per-priority percentage gives us a single rule
// that scales: a 1-hour response SLA gets a 30-minute heads-up; a
// 3-day SLA gets a day-and-a-half heads-up. Operators don't need to
// configure threshold minutes per priority.

const TICKET_BATCH_LIMIT = 500;

export const slaMonitor = inngest.createFunction(
  {
    id: "sla-monitor",
    triggers: cron("*/5 * * * *"),
  },
  async ({ step }) => {
    const now = new Date();
    const t50 = now;
    const t80 = now;
    const tBreach = now;

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
      })
      .from(tickets)
      .where(
        and(
          ne(tickets.status, "resolved"),
          ne(tickets.status, "closed"),
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
          await emitDispatch(t, target.kind, "sla.warning_50");
        });
        summary.warned50++;
      }

      if (pct >= 0.8 && !t.slaWarning80At) {
        await step.run(`warn80-${t.id}`, async () => {
          await db
            .update(tickets)
            .set({ slaWarning80At: t80, updatedAt: sql`now()` })
            .where(and(eq(tickets.id, t.id), isNull(tickets.slaWarning80At)));
          await emitDispatch(t, target.kind, "sla.warning_80");
          await smsAssignee(t, "sla_warning_80");
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
          await emitDispatch(t, target.kind, "sla.breached");
          await smsAssignee(t, "sla_breached");
        });
        summary.breached++;
      }
    }

    return summary;
  },
);

async function emitDispatch(
  t: { id: string; ticketNumber: string },
  kind: "response" | "resolution",
  type: "sla.warning_50" | "sla.warning_80" | "sla.breached",
): Promise<void> {
  // M11 wires this up to fan out to email + SMS + in-app. For now the
  // event is fired so a downstream listener (when added) picks it up
  // without any change here.
  try {
    await inngest.send({
      name: "notification/dispatch",
      data: {
        type,
        ticketId: t.id,
        ticketNumber: t.ticketNumber,
        payload: { kind },
      },
    });
  } catch (err) {
    console.error("[sla-monitor] dispatch emit failed:", err);
  }
}

async function smsAssignee(
  t: { id: string; ticketNumber: string; assignedToId: string | null },
  template: "sla_warning_80" | "sla_breached",
): Promise<void> {
  // Best-effort: only fires when the ticket is actually assigned and the
  // assignee has a phone configured. M11's dispatch fan-out will replace
  // this inline send with notification-preference-aware delivery.
  if (!t.assignedToId) return;
  try {
    const [tech] = await db
      .select({
        phone: users.phone,
        language: users.language,
      })
      .from(users)
      .where(eq(users.id, t.assignedToId))
      .limit(1);
    if (!tech?.phone) return;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    await sendSms({
      to: tech.phone,
      locale: tech.language,
      template: {
        template,
        data: {
          ticketNumber: t.ticketNumber,
          ticketUrl: `${appUrl}/admin/tickets/${t.id}`,
        },
      },
    });
  } catch (err) {
    console.error(`[sla-monitor] ${template} SMS failed:`, err);
  }
}
