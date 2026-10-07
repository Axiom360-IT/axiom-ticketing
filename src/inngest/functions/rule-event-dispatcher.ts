import { cron } from "inngest";
import { withAutomationRun } from "@/lib/automations/runs";
import { drainChangeFeed } from "@/lib/rules/changefeed";
import { engineClock } from "@/lib/rules/facts";
import { getSetting } from "@/lib/settings";
import { inngest } from "../client";

// Drains the ticket change outbox and runs the rules that watch for events.
//
// Every two minutes, which is the tightest cadence of the three dispatchers
// because this is the one an operator perceives as "instant": a rule saying
// "when a critical ticket arrives, text the on-call technician" is judged on
// how long that text takes.
//
// It is also the CHEAPEST of the three. A pass with an empty outbox is a
// single indexed count against a partial index — unlike the scanner, which
// has to look at tickets. That is what makes two minutes affordable on
// Neon's compute budget when the SLA monitor needs twenty.
//
// Batching, not draining-to-empty, is deliberate: a backlog (a bulk import, a
// migration touching every ticket) is worked through over several passes
// rather than one long transaction holding a connection open.
export const ruleEventDispatcher = inngest.createFunction(
  {
    id: "rule-event-dispatcher",
    triggers: cron("*/2 * * * *"),
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
