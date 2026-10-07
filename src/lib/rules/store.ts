import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  automationRules,
  ruleActionLog,
  ruleFires,
  ruleMissLog,
} from "@/lib/db/schema/automation-rules";
import { parseStoredRule } from "./schema";
import type {
  AutomationRule,
  ConditionGroup,
  RuleAction,
  RuleDedupe,
  RuleTrigger,
} from "./types";
import { DEFAULT_HOURLY_ACTION_BUDGET } from "./types";

// ── Reading and writing rules ─────────────────────────────────────────

export type RuleRow = typeof automationRules.$inferSelect;

/** A rule that parsed cleanly and is safe to run. */
export type LoadedRule = AutomationRule & {
  hourlyBudget: number;
  budgetSpent: number;
  budgetWindowStartedAt: Date | null;
  createdAt: Date;
};

export type RuleLoad = {
  runnable: LoadedRule[];
  /** Rows whose jsonb no longer parses, with the reason, so the caller can
   *  mark them broken instead of silently skipping them (invariant I5). */
  broken: { id: string; name: string; reason: string }[];
};

function toLoaded(row: RuleRow, parts: {
  trigger: RuleTrigger;
  conditions: ConditionGroup;
  actions: RuleAction[];
}): LoadedRule {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    order: row.order,
    trigger: parts.trigger,
    conditions: parts.conditions,
    actions: parts.actions,
    dedupe: (row.dedupe ?? { policy: "once_per_occurrence" }) as RuleDedupe,
    stopOnMatch: row.stopOnMatch,
    allowChaining: row.allowChaining,
    applyToExisting: row.applyToExisting,
    brokenReason: row.brokenReason,
    hourlyBudget: row.hourlyBudget ?? DEFAULT_HOURLY_ACTION_BUDGET,
    budgetSpent: row.budgetSpent ?? 0,
    budgetWindowStartedAt: row.budgetWindowStartedAt,
    createdAt: row.createdAt,
  };
}

/**
 * Parse a batch of rows into runnable rules, separating the unparseable.
 *
 * One bad row must not stop the other forty running, which is why this
 * returns two lists rather than throwing.
 */
function partition(rows: RuleRow[]): RuleLoad {
  const runnable: LoadedRule[] = [];
  const broken: RuleLoad["broken"] = [];
  for (const row of rows) {
    const parsed = parseStoredRule(row);
    if (!parsed.ok) {
      broken.push({ id: row.id, name: row.name, reason: parsed.reason });
      continue;
    }
    runnable.push(toLoaded(row, parsed.parts));
  }
  return { runnable, broken };
}

/** Enabled, unbroken rules for a set of trigger keys, in run order. */
export async function loadRulesFor(
  kind: "event" | "state" | "schedule",
  triggerKeys?: string[],
): Promise<RuleLoad> {
  const where =
    triggerKeys && triggerKeys.length > 0
      ? and(
          eq(automationRules.triggerKind, kind),
          eq(automationRules.enabled, true),
          sql`${automationRules.brokenReason} IS NULL`,
          inArray(automationRules.triggerKey, triggerKeys),
        )
      : and(
          eq(automationRules.triggerKind, kind),
          eq(automationRules.enabled, true),
          sql`${automationRules.brokenReason} IS NULL`,
        );

  const rows = await db
    .select()
    .from(automationRules)
    .where(where)
    // Total order: `order`, then createdAt. Without the tiebreak, two rules
    // at the same order would run in whatever sequence Postgres felt like,
    // and `stopOnMatch` would be non-deterministic (invariant I4).
    .orderBy(asc(automationRules.order), asc(automationRules.createdAt));

  return partition(rows);
}

export async function loadRule(id: string): Promise<LoadedRule | null> {
  const [row] = await db
    .select()
    .from(automationRules)
    .where(eq(automationRules.id, id))
    .limit(1);
  if (!row) return null;
  const parsed = parseStoredRule(row);
  return parsed.ok ? toLoaded(row, parsed.parts) : null;
}

export async function listRuleRows(): Promise<RuleRow[]> {
  return db
    .select()
    .from(automationRules)
    .orderBy(asc(automationRules.order), asc(automationRules.createdAt));
}

/** Mark a rule broken, with the reason the operator will read on the card. */
export async function markBroken(id: string, reason: string): Promise<void> {
  try {
    await db
      .update(automationRules)
      .set({ brokenReason: reason.slice(0, 500), updatedAt: new Date() })
      .where(eq(automationRules.id, id));
  } catch (err) {
    console.error(`[rules] could not mark ${id} broken:`, err);
  }
}

/** Clear the broken flag — called on every successful save. */
export async function clearBroken(id: string): Promise<void> {
  await db
    .update(automationRules)
    .set({ brokenReason: null, updatedAt: new Date() })
    .where(eq(automationRules.id, id));
}

// ── The hourly action budget (invariant I2) ───────────────────────────

const WINDOW_MS = 60 * 60 * 1000;

export type BudgetVerdict =
  | { ok: true; remaining: number }
  | { ok: false; spent: number; budget: number };

/**
 * Charge a firing against the rule's hourly budget.
 *
 * Rolling window, reset lazily on first use after it expires — cheaper than a
 * cron, and a rule that never fires needs no bookkeeping at all.
 *
 * Returns `ok: false` when the charge would exceed the budget; the caller
 * then pauses the rule rather than carrying on. A mis-written rule costs one
 * hour of noise, not a day of it.
 */
export async function chargeBudget(
  rule: LoadedRule,
  cost: number,
  now: Date,
): Promise<BudgetVerdict> {
  const windowStart = rule.budgetWindowStartedAt;
  const expired =
    !windowStart || now.getTime() - windowStart.getTime() >= WINDOW_MS;
  const spentSoFar = expired ? 0 : rule.budgetSpent;

  if (spentSoFar + cost > rule.hourlyBudget) {
    return { ok: false, spent: spentSoFar, budget: rule.hourlyBudget };
  }

  // Written with the increment in SQL rather than read-modify-write, so two
  // dispatchers charging the same rule in the same second cannot lose one of
  // the charges.
  await db
    .update(automationRules)
    .set(
      expired
        ? { budgetWindowStartedAt: now, budgetSpent: cost, lastFiredAt: now }
        : {
            budgetSpent: sql`${automationRules.budgetSpent} + ${cost}`,
            lastFiredAt: now,
          },
    )
    .where(eq(automationRules.id, rule.id));

  // Keep the in-memory copy honest for the rest of this pass, so a rule
  // matching 300 tickets stops at its budget within a single run rather than
  // only on the next one.
  rule.budgetSpent = spentSoFar + cost;
  rule.budgetWindowStartedAt = expired ? now : windowStart;

  return { ok: true, remaining: rule.hourlyBudget - rule.budgetSpent };
}

/** Pause a rule that has exhausted its budget, and say so on the card. */
export async function pauseForBudget(
  rule: LoadedRule,
  spent: number,
): Promise<void> {
  await db
    .update(automationRules)
    .set({
      enabled: false,
      brokenReason: `Paused automatically: it tried to do more than ${rule.hourlyBudget} things in an hour (${spent} already done). Check the rule, then switch it back on.`,
      updatedAt: new Date(),
    })
    .where(eq(automationRules.id, rule.id));
}

// ── The fire ledger (invariant I3) ────────────────────────────────────

/**
 * Claim this firing. `true` means we won it and must now run the actions.
 *
 * The row goes in BEFORE any action runs. A crash between the claim and the
 * action loses that one firing; the alternative ordering loses nothing and
 * duplicates everything, which is worse — an operator can chase a missing
 * alert, but cannot un-send forty texts.
 */
export async function claimFire(
  ruleId: string,
  ticketId: string | null,
  occurrenceKey: string | null,
): Promise<boolean> {
  // No key means the policy is `always`: nothing to claim, nothing to record.
  if (occurrenceKey === null) return true;

  const inserted = await db
    .insert(ruleFires)
    .values({ ruleId, ticketId, occurrenceKey })
    .onConflictDoNothing()
    .returning();

  return inserted.length > 0;
}

/** Undo a claim whose actions all failed, so a retry can try again. */
export async function releaseFire(
  ruleId: string,
  ticketId: string | null,
  occurrenceKey: string | null,
): Promise<void> {
  if (occurrenceKey === null) return;
  try {
    await db
      .delete(ruleFires)
      .where(
        and(
          eq(ruleFires.ruleId, ruleId),
          ticketId === null
            ? sql`${ruleFires.ticketId} IS NULL`
            : eq(ruleFires.ticketId, ticketId),
          eq(ruleFires.occurrenceKey, occurrenceKey),
        ),
      );
  } catch (err) {
    console.error("[rules] could not release a fire claim:", err);
  }
}

// ── Logging ───────────────────────────────────────────────────────────
//
// Best-effort, like `automation_runs`: a rule must never fail because its own
// bookkeeping failed.

export type ActionLogEntry = {
  ruleId: string;
  ticketId: string | null;
  ticketNumber: string | null;
  triggerKey: string;
  actionType: string;
  outcome: "ok" | "skipped" | "error";
  detail?: string | null;
  error?: string | null;
};

export async function logActions(entries: ActionLogEntry[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    await db.insert(ruleActionLog).values(
      entries.map((e) => ({
        ruleId: e.ruleId,
        ticketId: e.ticketId,
        ticketNumber: e.ticketNumber,
        triggerKey: e.triggerKey,
        actionType: e.actionType,
        outcome: e.outcome,
        detail: e.detail?.slice(0, 1000) ?? null,
        error: e.error?.slice(0, 2000) ?? null,
      })),
    );
  } catch (err) {
    console.error("[rules] could not write the action log:", err);
  }
}

export type MissLogEntry = {
  ruleId: string;
  ticketId: string | null;
  ticketNumber: string | null;
  triggerKey: string;
  reason: string;
  failedAt: string | null;
};

/** Why a rule whose trigger fired did not match. The "why didn't it fire?"
 *  answer, and high-volume, so it is pruned hard by housekeeping. */
export async function logMisses(entries: MissLogEntry[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    await db.insert(ruleMissLog).values(
      entries.map((e) => ({
        ruleId: e.ruleId,
        ticketId: e.ticketId,
        ticketNumber: e.ticketNumber,
        triggerKey: e.triggerKey,
        reason: e.reason.slice(0, 1000),
        failedAt: e.failedAt,
      })),
    );
  } catch (err) {
    console.error("[rules] could not write the miss log:", err);
  }
}

export async function recentActivityFor(ruleId: string, limit = 25) {
  const [actions, misses] = await Promise.all([
    db
      .select()
      .from(ruleActionLog)
      .where(eq(ruleActionLog.ruleId, ruleId))
      .orderBy(desc(ruleActionLog.createdAt))
      .limit(limit),
    db
      .select()
      .from(ruleMissLog)
      .where(eq(ruleMissLog.ruleId, ruleId))
      .orderBy(desc(ruleMissLog.createdAt))
      .limit(limit),
  ]);
  return { actions, misses };
}

/** Per-rule counts for the cards: what each rule did in a trailing window. */
export async function activityCounts(
  sinceHours = 24,
): Promise<Map<string, { ok: number; errors: number }>> {
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
  const rows = await db
    .select({
      ruleId: ruleActionLog.ruleId,
      outcome: ruleActionLog.outcome,
      n: sql<number>`count(*)::int`,
    })
    .from(ruleActionLog)
    .where(gte(ruleActionLog.createdAt, since))
    .groupBy(ruleActionLog.ruleId, ruleActionLog.outcome);

  const out = new Map<string, { ok: number; errors: number }>();
  for (const r of rows) {
    const cur = out.get(r.ruleId) ?? { ok: 0, errors: 0 };
    if (r.outcome === "error") cur.errors += Number(r.n);
    else if (r.outcome === "ok") cur.ok += Number(r.n);
    out.set(r.ruleId, cur);
  }
  return out;
}

// ── Retention ─────────────────────────────────────────────────────────

/** Called from nightly housekeeping. Misses are pruned harder than actions:
 *  they are diagnostic, not a record of anything having happened. */
export async function pruneRuleHistory(
  actionDays: number,
  missDays = 3,
): Promise<{ actions: number; misses: number; fires: number }> {
  const cut = (days: number) =>
    new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const actions = await db
    .delete(ruleActionLog)
    .where(lt(ruleActionLog.createdAt, cut(actionDays)))
    .returning();
  const misses = await db
    .delete(ruleMissLog)
    .where(lt(ruleMissLog.createdAt, cut(missDays)))
    .returning();
  // Fires are the idempotency ledger, NOT history — pruning one lets its rule
  // fire again for that ticket. Only throttle and per-occurrence keys are
  // safe to drop, and only well past any plausible window; `once` keys are
  // kept forever because that is exactly what they promise.
  const fires = await db
    .delete(ruleFires)
    .where(
      and(
        lt(ruleFires.firedAt, cut(180)),
        sql`${ruleFires.occurrenceKey} <> 'once'`,
      ),
    )
    .returning();

  return {
    actions: actions.length,
    misses: misses.length,
    fires: fires.length,
  };
}
