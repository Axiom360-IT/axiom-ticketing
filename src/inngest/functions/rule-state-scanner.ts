import { cron } from "inngest";
import { withAutomationRun } from "@/lib/automations/runs";
import { runRules } from "@/lib/rules/engine";
import { engineClock } from "@/lib/rules/facts";
import { findStateCandidates } from "@/lib/rules/scan";
import { type LoadedRule, loadRulesFor, markBroken } from "@/lib/rules/store";
import { getSetting } from "@/lib/settings";
import { inngest } from "../client";

// Runs the rules that watch for a ticket WAITING — "no owner for 30 minutes",
// "nobody has answered for an hour".
//
// Ten minutes, not two. These rules are measured in tens of minutes and hours,
// so finer granularity buys nothing an operator could notice while costing a
// query per shape every pass. The same trade the SLA monitor made when it
// widened to twenty.
//
// Nothing here is per-rule: `findStateCandidates` issues ONE query per state
// shape at the smallest threshold any rule asked for, and the engine narrows
// per rule afterwards. Twelve rules about unassigned tickets cost one query
// between them.
export const ruleStateScanner = inngest.createFunction(
  {
    id: "rule-state-scanner",
    triggers: cron("*/10 * * * *"),
  },
  async () =>
    withAutomationRun("rule-state-scanner", async () => {
      if ((await getSetting<boolean>("rules.enabled")) === false) {
        return { skipped: "switched off" };
      }

      const { runnable, broken } = await loadRulesFor("state");
      for (const b of broken) await markBroken(b.id, b.reason);
      if (runnable.length === 0) return { skipped: "no rules watch for waiting" };

      const { candidates, scans, truncated } = await findStateCandidates(runnable);
      if (candidates.length === 0) {
        return { skipped: "nothing is waiting", scans, rules: runnable.length };
      }

      const rulesFor = new Map<string, LoadedRule[]>();
      for (const rule of runnable) {
        if (rule.trigger.kind !== "state") continue;
        const list = rulesFor.get(rule.trigger.state) ?? [];
        list.push(rule);
        rulesFor.set(rule.trigger.state, list);
      }

      const clock = await engineClock(new Date());
      const summary = await runRules({ candidates, rulesFor, clock });

      return {
        ...summary,
        scans,
        rules: runnable.length,
        // Never silent: a capped scan must not read as "nothing else waiting".
        ...(truncated.length > 0 ? { cappedShapes: truncated } : {}),
      };
    }),
);
