import { cron } from "inngest";
import { withAutomationRun } from "@/lib/automations/runs";
import { drainChangeFeed } from "@/lib/rules/changefeed";
import { engineClock } from "@/lib/rules/facts";
import { getSetting } from "@/lib/settings";
import { inngest } from "../client";

// Drains the ticket change outbox and runs the rules that watch for events.
//
// Hourly. This used to wake every two minutes so a rule felt "instant", but
// every wake-up is a billable Inngest execution: at */2 this one job was ~720
// runs a day (~21k a month) — most of the Hobby plan's 50k allowance — while
// no rules existed at all, so every pass returned "nothing queued". The
// outbox itself is unaffected (a Postgres trigger fills it regardless), so
// nothing is lost by waking less often; an event rule simply reacts within
// the hour instead of within two minutes. If rules become latency-sensitive,
// tighten this (e.g. every 10–15 minutes) and re-check the plan's usage.
//
// Batching, not draining-to-empty, is deliberate: a backlog (a bulk import, a
// migration touching every ticket) is worked through over several passes
// rather than one long transaction holding a connection open.
export const ruleEventDispatcher = inngest.createFunction(
  {
    id: "rule-event-dispatcher",
    triggers: cron("0 * * * *"),
  },
  async () =>
    withAutomationRun("rule-event-dispatcher", async () => {
      if ((await getSetting<boolean>("rules.enabled")) === false) {
        return { skipped: "switched off" };
      }

      const batch = (await getSetting<number>("rules.drain_batch")) ?? 200;
      const clock = await engineClock(new Date());
      const result = await drainChangeFeed(clock, batch);

      if (result.drained === 0) return { skipped: "nothing queued" };
      return result;
    }),
);
