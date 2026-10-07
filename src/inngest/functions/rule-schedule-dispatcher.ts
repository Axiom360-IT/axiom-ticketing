import { and, isNull, ne, sql } from "drizzle-orm";
import { cron } from "inngest";
import { withAutomationRun } from "@/lib/automations/runs";
import { isReportDue, safeLocalMoment } from "@/lib/automations/schedule";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema/tickets";
import { type Candidate, runRules } from "@/lib/rules/engine";
import { engineClock } from "@/lib/rules/facts";
import { claimFire, type LoadedRule, loadRulesFor, markBroken } from "@/lib/rules/store";
import { MAX_MATCHES_PER_RUN } from "@/lib/rules/types";
import { getSetting } from "@/lib/settings";
import { inngest } from "../client";

// Runs the rules that fire on a clock — "every weekday at 08:00, …".
//
// A scheduled rule is "at this time, look at every open ticket and act on the
// ones that match". It is NOT a digest: each matching ticket is acted on
// individually, which is what makes "every morning, flag any critical ticket
// nobody has picked up" expressible. A one-email-per-day summary is what
// scheduled reports are for, and they already exist.
//
// Five minutes, matching the report dispatcher, for the same reason: a rule
// set for 08:00 should not wait until 08:10. `isReportDue` is reused verbatim
// — the "at or after, once per local date" logic is identical and already
// DST-tested, and a second copy would be a second thing to get wrong.
export const ruleScheduleDispatcher = inngest.createFunction(
  {
    id: "rule-schedule-dispatcher",
    triggers: cron("*/5 * * * *"),
  },
  async () =>
    withAutomationRun("rule-schedule-dispatcher", async () => {
      if ((await getSetting<boolean>("rules.enabled")) === false) {
        return { skipped: "switched off" };
      }

      const { runnable, broken } = await loadRulesFor("schedule");
      for (const b of broken) await markBroken(b.id, b.reason);
      if (runnable.length === 0) return { skipped: "no rules run on a clock" };

      const clock = await engineClock(new Date());
      const moment = safeLocalMoment(clock.now, clock.timezone);

      // Which rules are due right now.
      //
      // `lastRunOn` comes from the fire ledger rather than a column: a
      // schedule rule claims `date:<local date>` with a NULL ticket, so the
      // unique index is the same double-send guard the rest of the engine
      // uses. One mechanism, not two.
      const due: LoadedRule[] = [];
      for (const rule of runnable) {
        if (rule.trigger.kind !== "schedule") continue;
        const verdict = isReportDue(
          {
            hour: rule.trigger.hour,
            minute: rule.trigger.minute,
            weekdays: rule.trigger.weekdays,
            enabled: rule.enabled,
            lastRunOn: null,
          },
          moment,
        );
        if (!verdict.due) continue;
        // Claim the DAY before doing any work. A crash part-way through loses
        // the rest of today's run rather than repeating the part that
        // already went out.
        const won = await claimFire(rule.id, null, `date:${verdict.forDate}`);
        if (won) due.push(rule);
      }

      if (due.length === 0) {
        return { skipped: "nothing due", rules: runnable.length };
      }

      // One query for the whole pass, shared by every due rule — the same
      // batching rule the state scanner follows.
      const openTickets = await db
        .select({ id: tickets.id })
        .from(tickets)
        .where(
          and(
            isNull(tickets.deletedAt),
            ne(tickets.status, "resolved"),
            ne(tickets.status, "closed"),
            ne(tickets.status, "draft"),
          ),
        )
        .orderBy(sql`${tickets.createdAt} DESC`)
        .limit(MAX_MATCHES_PER_RUN);

      if (openTickets.length === 0) {
        return { skipped: "no open tickets", due: due.length };
      }

      const rulesFor = new Map<string, LoadedRule[]>();
      const candidates: Candidate[] = [];
      for (const rule of due) {
        rulesFor.set(rule.id, [rule]);
        for (const t of openTickets) {
          // The trigger key is the rule's own id: a schedule rule is its own
          // trigger, so there is no shared event name to group by.
          candidates.push({
            ticketId: t.id,
            triggerKey: rule.id,
            localDate: moment.date,
          });
        }
      }

      const summary = await runRules({ candidates, rulesFor, clock });
      return { ...summary, due: due.length, scanned: openTickets.length };
    }),
);
