import "server-only";
import { asc, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ticketChangeEvents } from "@/lib/db/schema/automation-rules";
import { type Candidate, runRules } from "./engine";
import { type ChangeDiff, eventsFromDiff } from "./evaluate";
import type { EngineClock } from "./facts";
import { type LoadedRule, loadRulesFor, markBroken } from "./store";
import type { EngineSummary } from "./engine";

// ── Draining the outbox ───────────────────────────────────────────────
//
// The database trigger records WHAT changed; this turns that into WHAT
// HAPPENED and runs the rules that care.
//
// Rows are marked processed whether or not any rule matched — the outbox is a
// queue, not a history. Rows that nothing matched are still kept until
// retention expires, because "why did nothing fire?" is a question somebody
// will ask.

export type DrainResult = EngineSummary & {
  drained: number;
  remaining: number;
  /** Present when the pass had nothing to do. `withAutomationRun` reads this
   *  key to record the run as `skipped` rather than `ok` — "ran, found
   *  nothing" and "ran, did work" are different answers on the panel. */
  skipped?: string;
};

export async function drainChangeFeed(
  clock: EngineClock,
  batchSize: number,
): Promise<DrainResult> {
  const rows = await db
    .select()
    .from(ticketChangeEvents)
    .where(isNull(ticketChangeEvents.processedAt))
    .orderBy(asc(ticketChangeEvents.createdAt))
    .limit(Math.min(Math.max(batchSize, 10), 2000));

  if (rows.length === 0) {
    return {
      drained: 0,
      remaining: 0,
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
  }

  const candidates: Candidate[] = [];
  const keysSeen = new Set<string>();

  for (const row of rows) {
    const diff: ChangeDiff = {
      op: row.op as ChangeDiff["op"],
      changed: (row.changed ?? {}) as ChangeDiff["changed"],
      message: (row.messageFacts ?? undefined) as ChangeDiff["message"],
    };
    for (const event of eventsFromDiff(diff)) {
      keysSeen.add(event);
      candidates.push({
        ticketId: row.ticketId,
        triggerKey: event,
        changeEventId: row.id,
        causedByRuleId: row.causedByRuleId,
        chainDepth: row.chainDepth,
        // An event rule's cold-start guard uses the change's own timestamp:
        // a rule written at noon must not act on a change from this morning.
        stateStartedAt: row.createdAt,
      });
    }
  }

  // Mark processed BEFORE running the rules.
  //
  // Same reasoning as claiming a firing before acting: a crash mid-pass must
  // lose work rather than repeat it. The firing ledger is the real guard
  // against duplicates, so the worst case here is a missed alert — which an
  // operator can notice and chase, unlike forty duplicate texts.
  await db
    .update(ticketChangeEvents)
    .set({ processedAt: clock.now })
    .where(
      inArray(
        ticketChangeEvents.id,
        rows.map((r) => r.id),
      ),
    );

  const [{ n: remaining }] = (
    await db.execute(
      sql`SELECT count(*)::int AS n FROM "ticket_change_events" WHERE "processed_at" IS NULL`,
    )
  ).rows as { n: number }[];

  if (candidates.length === 0) {
    return {
      drained: rows.length,
      remaining: Number(remaining ?? 0),
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
  }

  const { runnable, broken } = await loadRulesFor("event", [...keysSeen]);
  for (const b of broken) await markBroken(b.id, b.reason);

  // Nothing watches any of these events, so stop before `runRules` — it would
  // otherwise build a full FactSheet for every ticket in the batch (nine
  // queries) only to find no rule to evaluate against them.
  //
  // This is the common case, not an edge case: with no event rules written
  // yet, the dispatcher wakes 720 times a day, and each pass would load facts
  // for every ticket touched since the last one. The SLA monitor was widened
  // from 5 minutes to 20 for exactly this budget, and the two other
  // dispatchers already return early for the same reason.
  if (runnable.length === 0) {
    return {
      drained: rows.length,
      remaining: Number(remaining ?? 0),
      skipped: "no rules watch these events",
      candidates: candidates.length,
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
  }

  const rulesFor = new Map<string, LoadedRule[]>();
  for (const rule of runnable) {
    const key = rule.trigger.kind === "event" ? rule.trigger.event : null;
    if (!key) continue;
    const list = rulesFor.get(key) ?? [];
    list.push(rule);
    rulesFor.set(key, list);
  }

  const summary = await runRules({ candidates, rulesFor, clock });
  return { ...summary, drained: rows.length, remaining: Number(remaining ?? 0) };
}

/** Retention. Called from nightly housekeeping. Unprocessed rows are never
 *  dropped — that would silently lose work the engine has not done yet. */
export async function pruneChangeFeed(olderThanDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(ticketChangeEvents)
    .where(
      sql`${ticketChangeEvents.processedAt} IS NOT NULL AND ${ticketChangeEvents.createdAt} < ${cutoff}`,
    )
    .returning();
  return deleted.length;
}

/** How far behind the drain is — surfaced on the Automations page so a
 *  stalled dispatcher is visible without reading logs. */
export async function changeFeedBacklog(): Promise<{
  pending: number;
  oldest: Date | null;
}> {
  const [row] = (
    await db.execute(
      sql`SELECT count(*)::int AS n, min("created_at") AS oldest
          FROM "ticket_change_events" WHERE "processed_at" IS NULL`,
    )
  ).rows as { n: number; oldest: string | null }[];
  return {
    pending: Number(row?.n ?? 0),
    oldest: row?.oldest ? new Date(row.oldest) : null,
  };
}
