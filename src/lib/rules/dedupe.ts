// ── What makes one firing distinct from another ───────────────────────
//
// Pure, and tested, because both failure directions are bad in ways that are
// hard to notice: too coarse a key suppresses an alert somebody needed, too
// fine a key sends the same alert every time the scanner wakes up.
//
// The key is written to `rule_fires` BEFORE the actions run, under a unique
// index, so a unique violation is how a retry or a concurrent pass discovers
// it has nothing to do (invariant I3).

import type { DedupePolicy, RuleDedupe, RuleTrigger } from "./types";

export type OccurrenceInput = {
  dedupe: RuleDedupe;
  trigger: RuleTrigger;
  now: Date;
  /** For an event rule: the outbox row's id. Each distinct change is one
   *  occurrence, which is the only honest reading of "once each time it
   *  happens" for something that happens at a point in time. */
  changeEventId?: string;
  /** For a state rule: when the waiting began. Moves when the ticket leaves
   *  and re-enters the state, so a ticket that is assigned and then abandoned
   *  again counts as a NEW occurrence. */
  stateStartedAt?: Date | null;
  /** For a schedule rule: the local date, so one send per day survives a
   *  dispatcher that wakes every five minutes. Same guard, and the same
   *  reasoning, as `scheduled_reports.last_run_on`. */
  localDate?: string;
};

/**
 * The occurrence key, or `null` when this policy needs no ledger row at all.
 *
 * `always` returns null deliberately: writing a row per firing would grow the
 * ledger without ever being read, and "no deduplication" is exactly the
 * absence of a key rather than a unique one.
 */
export function occurrenceKey(input: OccurrenceInput): string | null {
  const { dedupe, trigger, now } = input;

  switch (dedupe.policy) {
    case "always":
      return null;

    case "once_per_ticket":
      // One row, forever, per (rule, ticket). For a schedule rule there is no
      // ticket, so this degrades to one row for the rule — which the zod
      // schema already rejects, but a stored row could predate that check.
      return "once";

    case "once_per_occurrence": {
      if (trigger.kind === "event") {
        // No change id (a preview, or a replay) falls back to the instant, so
        // the worst case is a duplicate rather than a silent drop.
        return `event:${input.changeEventId ?? now.toISOString()}`;
      }
      if (trigger.kind === "state") {
        // Minute precision: the scanner's own granularity. Second precision
        // would let an `updated_at` touch look like a new episode.
        const started = input.stateStartedAt;
        return `state:${started ? isoMinute(started) : "unknown"}`;
      }
      return `date:${input.localDate ?? isoMinute(now)}`;
    }

    case "throttle": {
      const minutes = dedupe.throttleMinutes;
      if (!minutes || minutes < 1) {
        // A throttle with no interval is a misconfiguration. Fall back to the
        // strictest safe reading — once per ticket — rather than to "always",
        // which would turn a broken rule into a flood.
        return "once";
      }
      const bucket = Math.floor(now.getTime() / (minutes * 60_000));
      return `throttle:${minutes}:${bucket}`;
    }

    default:
      return exhaustive(dedupe.policy);
  }
}

function exhaustive(p: never): never {
  throw new Error(`unhandled dedupe policy: ${String(p)}`);
}

/** `2026-10-07T14:32` — no seconds, no zone suffix noise. */
function isoMinute(d: Date): string {
  return d.toISOString().slice(0, 16);
}

/**
 * Policies the builder should offer for a given trigger kind.
 *
 * The exclusions are not cosmetic:
 *   • `always` on a state rule re-fires on every scan pass — six alerts an
 *     hour, forever, for one waiting ticket.
 * A schedule rule has no exclusions: it wakes on a clock and then evaluates
 * each open ticket, so every policy means what it says.
 */
export function policiesFor(kind: RuleTrigger["kind"]): DedupePolicy[] {
  switch (kind) {
    case "event":
      return ["always", "once_per_occurrence", "once_per_ticket", "throttle"];
    case "state":
      return ["once_per_occurrence", "once_per_ticket", "throttle"];
    case "schedule":
      // All four. A schedule rule evaluates each open ticket when its time
      // comes, so "once per ticket" and a throttle both mean what they say.
      // `always` is still bounded: the dispatcher claims the local DATE for
      // the rule before doing any work, so it runs once a day whatever the
      // policy says.
      return ["always", "once_per_occurrence", "once_per_ticket", "throttle"];
  }
}

/**
 * The default policy, which is the same for all three kinds.
 *
 * "Once each time it happens" is what an operator means by default in every
 * case: once per change for an event rule, once per episode of waiting for a
 * state rule, once per day for a schedule. `once_per_ticket` is the trap —
 * it looks like the safe choice and then silently stops working after the
 * first firing, which is the hardest kind of bug to notice.
 */
export function defaultPolicyFor(): DedupePolicy {
  return "once_per_occurrence";
}
