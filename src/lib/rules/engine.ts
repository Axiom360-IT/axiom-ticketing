import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { occurrenceKey } from "./dedupe";
import { evaluate } from "./evaluate";
import { type EngineClock, loadFacts } from "./facts";
import { type ActionOutcome, type ExecuteContext, runAction } from "./execute";
import { actionCost } from "./schema";
import {
  type ActionLogEntry,
  chargeBudget,
  claimFire,
  type LoadedRule,
  logActions,
  logMisses,
  markBroken,
  type MissLogEntry,
  pauseForBudget,
  releaseFire,
} from "./store";
import { MAX_CHAIN_DEPTH, MAX_MATCHES_PER_RUN } from "./types";

// ── The loop ──────────────────────────────────────────────────────────
//
// One function, shared by all three dispatchers. They differ only in how they
// find candidates: the event dispatcher drains the outbox, the scanner runs a
// query per state shape, the schedule dispatcher checks the clock. What
// happens to a candidate once found is identical, so it lives here once.
//
// Order of checks per rule, and the order matters:
//   1. broken?            — never run a rule we cannot trust
//   2. chaining allowed?  — cheapest loop guard, before any query
//   3. old enough?        — the cold-start guard, before evaluating
//   4. conditions hold?   — pure, no I/O
//   5. claim the firing   — BEFORE acting (invariant I3)
//   6. budget             — after the claim, so a budget refusal does not
//                           leave the firing available to retry forever
//   7. act

export type Candidate = {
  ticketId: string;
  /** The event name or state id that produced this candidate. */
  triggerKey: string;
  /** Outbox row id, for per-occurrence dedupe on event rules. */
  changeEventId?: string;
  /** When the waiting began, for per-occurrence dedupe on state rules. */
  stateStartedAt?: Date | null;
  /** Local date, for a schedule rule's per-ticket dedupe key. */
  localDate?: string;
  /** Set when a rule caused the change that produced this candidate. */
  causedByRuleId?: string | null;
  chainDepth?: number;
};

export type EngineSummary = {
  candidates: number;
  evaluated: number;
  matched: number;
  fired: number;
  actions: number;
  errors: number;
  skippedByDedupe: number;
  skippedByBudget: number;
  skippedByChaining: number;
  skippedAsExisting: number;
  truncated?: number;
};

const EMPTY: EngineSummary = {
  candidates: 0,
  evaluated: 0,
  matched: 0,
  fired: 0,
  actions: 0,
  errors: 0,
  skippedByDedupe: 0,
  skippedByBudget: 0,
  skippedByChaining: 0,
  skippedAsExisting: 0,
};

/**
 * Run rules against candidates.
 *
 * `rulesFor` maps a trigger key to the rules that watch it, so the caller
 * decides what "applicable" means without this function needing to know
 * whether it is looking at events or states.
 */
export async function runRules(opts: {
  candidates: Candidate[];
  rulesFor: Map<string, LoadedRule[]>;
  clock: EngineClock;
}): Promise<EngineSummary> {
  const { candidates, rulesFor, clock } = opts;
  const summary: EngineSummary = { ...EMPTY, candidates: candidates.length };
  if (candidates.length === 0) return summary;

  // The blast-radius cap (invariant I2). Logged when it bites — a silent
  // truncation reads as "nothing else matched", which is a lie that would
  // cost somebody a long afternoon.
  let working = candidates;
  if (working.length > MAX_MATCHES_PER_RUN) {
    summary.truncated = working.length - MAX_MATCHES_PER_RUN;
    working = working.slice(0, MAX_MATCHES_PER_RUN);
    console.warn(
      `[rules] ${summary.truncated} candidate(s) deferred to the next pass (cap ${MAX_MATCHES_PER_RUN})`,
    );
  }

  const byTicket = new Map<string, Candidate[]>();
  for (const c of working) {
    const list = byTicket.get(c.ticketId) ?? [];
    list.push(c);
    byTicket.set(c.ticketId, list);
  }

  const facts = await loadFacts([...byTicket.keys()], clock);
  const names = await resolveNames(facts);

  const actionLog: ActionLogEntry[] = [];
  const missLog: MissLogEntry[] = [];

  for (const [ticketId, ticketCandidates] of byTicket) {
    const sheet = facts.get(ticketId);
    // Deleted between the candidate query and now. Normal, not an error.
    if (!sheet) continue;

    // Every rule that any of this ticket's candidates could trigger, in run
    // order, de-duplicated — so a ticket with both `assigned` and
    // `priority_raised` queued still runs each rule at most once, and
    // `stopOnMatch` means the same thing it would with one event.
    const applicable = new Map<string, { rule: LoadedRule; candidate: Candidate }>();
    for (const c of ticketCandidates) {
      for (const rule of rulesFor.get(c.triggerKey) ?? []) {
        if (!applicable.has(rule.id)) applicable.set(rule.id, { rule, candidate: c });
      }
    }
    const ordered = [...applicable.values()].sort(
      (a, b) =>
        a.rule.order - b.rule.order ||
        a.rule.createdAt.getTime() - b.rule.createdAt.getTime(),
    );

    for (const { rule, candidate } of ordered) {
      if (rule.brokenReason) continue;

      // ── Loop guard (invariant I1) ──
      if (candidate.causedByRuleId && !rule.allowChaining) {
        summary.skippedByChaining++;
        continue;
      }
      if ((candidate.chainDepth ?? 0) >= MAX_CHAIN_DEPTH) {
        summary.skippedByChaining++;
        continue;
      }

      // ── Cold-start guard ──
      //
      // A rule saved today must not alert on a backlog that has been waiting
      // for months. `applyToExisting` is the operator's informed opt-in,
      // offered by the builder next to the count the preview showed them.
      if (!rule.applyToExisting && candidate.stateStartedAt) {
        if (candidate.stateStartedAt.getTime() < rule.createdAt.getTime()) {
          summary.skippedAsExisting++;
          continue;
        }
      }

      // ── Per-rule threshold for state rules ──
      //
      // The scanner runs ONE query per shape at the smallest threshold any
      // rule asked for, so its results are a superset. Narrowing per rule
      // here is what lets twelve "has been waiting" rules cost one query
      // between them rather than twelve (invariant I10).
      if (rule.trigger.kind === "state") {
        const startedAt = candidate.stateStartedAt;
        if (!startedAt) {
          summary.skippedAsExisting++;
          continue;
        }
        const waited = (clock.now.getTime() - startedAt.getTime()) / 60_000;
        if (waited < rule.trigger.minutes) continue;
      }

      summary.evaluated++;
      const decision = evaluate(rule.conditions, sheet);
      if (!decision.matches) {
        missLog.push({
          ruleId: rule.id,
          ticketId,
          ticketNumber: sheet.ticket.ticketNumber,
          triggerKey: candidate.triggerKey,
          reason: decision.reason,
          failedAt: decision.failedAt,
        });
        continue;
      }
      summary.matched++;

      // ── Claim, then charge, then act ──
      const key = occurrenceKey({
        dedupe: rule.dedupe,
        trigger: rule.trigger,
        now: clock.now,
        changeEventId: candidate.changeEventId,
        stateStartedAt: candidate.stateStartedAt,
        localDate: candidate.localDate,
      });

      const won = await claimFire(rule.id, ticketId, key);
      if (!won) {
        summary.skippedByDedupe++;
        if (rule.stopOnMatch) break;
        continue;
      }

      const cost = actionCost(rule.actions);
      const budget = await chargeBudget(rule, cost, clock.now);
      if (!budget.ok) {
        // Release the claim: the firing never happened, and when the operator
        // fixes the rule it should be free to fire again.
        await releaseFire(rule.id, ticketId, key);
        await pauseForBudget(rule, budget.spent);
        summary.skippedByBudget++;
        actionLog.push({
          ruleId: rule.id,
          ticketId,
          ticketNumber: sheet.ticket.ticketNumber,
          triggerKey: candidate.triggerKey,
          actionType: "budget",
          outcome: "skipped",
          detail: `Paused: it would have gone past ${rule.hourlyBudget} actions in an hour.`,
        });
        continue;
      }

      const ctx: ExecuteContext = {
        ruleId: rule.id,
        ruleName: rule.name,
        triggerKey: candidate.triggerKey,
        facts: sheet,
        assigneeName: sheet.ticket.assignedToId
          ? (names.get(sheet.ticket.assignedToId) ?? null)
          : null,
        customerName: null,
        now: clock.now,
      };

      const outcomes: ActionOutcome[] = [];
      for (const action of rule.actions) {
        outcomes.push(await runAction(action, ctx));
      }

      summary.fired++;
      for (const o of outcomes) {
        summary.actions++;
        if (o.outcome === "error") summary.errors++;
        actionLog.push({
          ruleId: rule.id,
          ticketId,
          ticketNumber: sheet.ticket.ticketNumber,
          triggerKey: candidate.triggerKey,
          actionType: o.actionType,
          outcome: o.outcome,
          detail: o.detail ?? null,
          error: o.error ?? null,
        });
      }

      // If EVERY action failed, the firing achieved nothing — release the
      // claim so a retry can try again. A partial success is kept claimed:
      // re-running would duplicate whatever did work.
      if (outcomes.length > 0 && outcomes.every((o) => o.outcome === "error")) {
        await releaseFire(rule.id, ticketId, key);
      }

      if (rule.stopOnMatch) break;
    }
  }

  await Promise.all([logActions(actionLog), logMisses(missLog)]);
  return summary;
}

/** Display names for the `{assigneeName}` placeholder, in one query. */
async function resolveNames(
  facts: Map<string, { ticket: { assignedToId: string | null } }>,
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      [...facts.values()]
        .map((f) => f.ticket.assignedToId)
        .filter((v): v is string => !!v),
    ),
  ];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Mark every rule a load reported as unparseable, so each card says why. */
export async function markLoadBroken(
  broken: { id: string; reason: string }[],
): Promise<void> {
  for (const b of broken) await markBroken(b.id, b.reason);
}

/** Is the engine switched on at all? The kill switch for the whole feature. */
export async function engineEnabled(
  getSetting: (key: string) => Promise<unknown>,
): Promise<boolean> {
  const v = await getSetting("rules.enabled");
  // Absent means on, matching every other automation switch in this codebase:
  // the panel reads the same default, so the two agree.
  return typeof v === "boolean" ? v : true;
}
