import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { type StateTriggerDef, STATE_TRIGGER_DEFS } from "./catalog";
import type { Candidate } from "./engine";
import type { RuleTrigger, StateTriggerId } from "./types";

/** All `planScans` needs. Narrow on purpose so the preview can call this
 *  with an unsaved rule rather than faking a stored one. */
export type ScannableRule = { trigger: RuleTrigger };

// ── Finding tickets that have been waiting ────────────────────────────
//
// One batched query per SHAPE, never one per rule (invariant I10). Several
// rules watching "unassigned for N minutes" with different Ns share a single
// query run at the SMALLEST N; each rule's own threshold is then checked
// against `stateStartedAt` in the engine, which costs nothing.
//
// That matters more here than anywhere else in the engine: the SLA monitor
// was widened from 5 minutes to 20 specifically to keep Neon's compute budget
// happy, and a scanner issuing a query per rule would quietly undo it the
// first time somebody wrote twelve rules.
//
// Every shape returns the same two columns: the ticket, and when its waiting
// began. `stateStartedAt` is doing two jobs — the per-rule threshold check,
// and the per-occurrence dedupe key, so that a ticket assigned and then
// abandoned again counts as a NEW episode rather than being suppressed
// forever by the first one.

const MAX_PER_SHAPE = 500;

/** Live tickets only. Resolved, closed, draft and deleted never wait. */
const OPEN = sql`t."deleted_at" IS NULL
  AND t."status" NOT IN ('resolved','closed','draft')`;

/** When a watched column last changed, from the outbox; falls back to the
 *  ticket's creation. See the note in facts.ts about the missing
 *  `status_changed_at` column and why the fallback is safe. */
function lastChangeOf(column: string) {
  return sql`COALESCE((
    SELECT max(e."created_at") FROM "ticket_change_events" e
    WHERE e."ticket_id" = t."id" AND e."changed" ? ${column}
  ), t."created_at")`;
}

function lastMessageOf(authorType: string) {
  return sql`(
    SELECT max(m."created_at") FROM "messages" m
    WHERE m."ticket_id" = t."id"
      AND m."author_type" = ${authorType}
      AND m."is_internal_note" = false
      AND m."moderation_status" = 'approved'
  )`;
}

type Row = { ticket_id: string; started_at: string | null };

/**
 * Candidates for one shape.
 *
 * `thresholdMinutes` is the smallest threshold across the rules sharing this
 * shape, so the query returns a superset and the engine narrows it.
 */
async function scanShape(
  shape: StateTriggerDef["shape"],
  thresholdMinutes: number,
): Promise<Row[]> {
  const cutoff = sql`now() - make_interval(mins => ${thresholdMinutes})`;

  const query = (() => {
    switch (shape) {
      case "unassigned":
        return sql`
          SELECT t."id" AS ticket_id, ${lastChangeOf("assigned_to_id")} AS started_at
          FROM "tickets" t
          WHERE ${OPEN} AND t."assigned_to_id" IS NULL
            AND ${lastChangeOf("assigned_to_id")} <= ${cutoff}`;

      case "status_age":
        return sql`
          SELECT t."id" AS ticket_id, ${lastChangeOf("status")} AS started_at
          FROM "tickets" t
          WHERE ${OPEN} AND ${lastChangeOf("status")} <= ${cutoff}`;

      case "no_first_response":
        return sql`
          SELECT t."id" AS ticket_id, t."created_at" AS started_at
          FROM "tickets" t
          WHERE ${OPEN} AND t."first_response_at" IS NULL
            AND t."created_at" <= ${cutoff}`;

      case "no_customer_reply":
        // Waiting on THEM: we wrote last, and they have not answered.
        return sql`
          SELECT t."id" AS ticket_id, ${lastMessageOf("agent")} AS started_at
          FROM "tickets" t
          WHERE ${OPEN}
            AND ${lastMessageOf("agent")} IS NOT NULL
            AND ${lastMessageOf("agent")} <= ${cutoff}
            AND COALESCE(${lastMessageOf("customer")}, 'epoch'::timestamptz)
                < ${lastMessageOf("agent")}`;

      case "no_agent_reply":
        // Waiting on US: they wrote last, and nobody has answered.
        return sql`
          SELECT t."id" AS ticket_id, ${lastMessageOf("customer")} AS started_at
          FROM "tickets" t
          WHERE ${OPEN}
            AND ${lastMessageOf("customer")} IS NOT NULL
            AND ${lastMessageOf("customer")} <= ${cutoff}
            AND COALESCE(${lastMessageOf("agent")}, 'epoch'::timestamptz)
                < ${lastMessageOf("customer")}`;

      case "resolved_no_csat":
        // Deliberately NOT gated on OPEN: a resolved ticket is exactly the
        // subject here.
        return sql`
          SELECT t."id" AS ticket_id, t."resolved_at" AS started_at
          FROM "tickets" t
          WHERE t."deleted_at" IS NULL
            AND t."status" = 'resolved'
            AND t."csat_rating" IS NULL
            AND t."resolved_at" IS NOT NULL
            AND t."resolved_at" <= ${cutoff}`;

      case "past_due":
        return sql`
          SELECT t."id" AS ticket_id, t."resolution_due_at" AS started_at
          FROM "tickets" t
          WHERE ${OPEN}
            AND t."sla_paused_at" IS NULL
            AND t."resolution_due_at" IS NOT NULL
            AND t."resolution_due_at" <= ${cutoff}`;

      case "open_age":
        return sql`
          SELECT t."id" AS ticket_id, t."created_at" AS started_at
          FROM "tickets" t
          WHERE ${OPEN} AND t."created_at" <= ${cutoff}`;

      case "no_work_logged":
        return sql`
          SELECT t."id" AS ticket_id,
                 COALESCE((SELECT max(w."created_at") FROM "work_logs" w
                           WHERE w."ticket_id" = t."id"), t."created_at") AS started_at
          FROM "tickets" t
          WHERE ${OPEN}
            AND COALESCE((SELECT max(w."created_at") FROM "work_logs" w
                          WHERE w."ticket_id" = t."id"), t."created_at") <= ${cutoff}`;
    }
  })();

  const res = await db.execute(
    sql`${query} ORDER BY started_at ASC LIMIT ${MAX_PER_SHAPE}`,
  );
  return res.rows as Row[];
}

export type ScanPlan = {
  shape: StateTriggerDef["shape"];
  /** Trigger ids sharing this shape — the candidates apply to all of them. */
  states: StateTriggerId[];
  thresholdMinutes: number;
};

/** Group rules into one scan per shape, at the smallest threshold. */
export function planScans(rules: ScannableRule[]): ScanPlan[] {
  const byShape = new Map<StateTriggerDef["shape"], ScanPlan>();

  for (const rule of rules) {
    if (rule.trigger.kind !== "state") continue;
    const state = rule.trigger.state;
    const def = STATE_TRIGGER_DEFS[state];
    if (!def) continue;

    const existing = byShape.get(def.shape);
    if (!existing) {
      byShape.set(def.shape, {
        shape: def.shape,
        states: [state],
        thresholdMinutes: rule.trigger.minutes,
      });
      continue;
    }
    if (!existing.states.includes(state)) existing.states.push(state);
    existing.thresholdMinutes = Math.min(
      existing.thresholdMinutes,
      rule.trigger.minutes,
    );
  }

  return [...byShape.values()];
}

/** Run every planned scan and flatten to candidates. */
export async function findStateCandidates(
  rules: ScannableRule[],
): Promise<{ candidates: Candidate[]; scans: number; truncated: string[] }> {
  const plans = planScans(rules);
  const candidates: Candidate[] = [];
  const truncated: string[] = [];

  for (const plan of plans) {
    const rows = await scanShape(plan.shape, plan.thresholdMinutes);
    if (rows.length === MAX_PER_SHAPE) {
      // Never silent: a capped scan reads as "nothing else is waiting",
      // which is the one thing it must not be allowed to mean.
      truncated.push(plan.shape);
    }
    for (const row of rows) {
      const startedAt = row.started_at ? new Date(row.started_at) : null;
      for (const state of plan.states) {
        candidates.push({
          ticketId: row.ticket_id,
          triggerKey: state,
          stateStartedAt: startedAt,
        });
      }
    }
  }

  return { candidates, scans: plans.length, truncated };
}
