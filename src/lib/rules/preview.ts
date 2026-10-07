import "server-only";
import { and, desc, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema/tickets";
import { STATE_TRIGGER_DEFS } from "./catalog";
import { evaluate } from "./evaluate";
import { engineClock, loadFacts } from "./facts";
import type { ConditionGroup, RuleTrigger } from "./types";

// ── "What would this rule do right now?" ──────────────────────────────
//
// No rule is ever saved blind. Before the save button does anything, the
// builder says how many open tickets match and names a few of them — which is
// the difference between an operator confidently writing a rule and an
// operator discovering at 02:00 that it texts fourteen people.
//
// Read-only and side-effect free: it writes no fire rows, no logs, and
// touches no budget. Running a preview twenty times while tuning a condition
// costs nothing but queries.

const SAMPLE_SIZE = 10;
const SCAN_LIMIT = 500;

export type PreviewSample = {
  id: string;
  ticketNumber: string;
  subject: string;
  priority: string;
  status: string;
};

export type RulePreview = {
  /** How many open tickets match, capped at SCAN_LIMIT. */
  matches: number;
  /** True when the count hit the cap and the real number is higher. */
  capped: boolean;
  /** How many tickets were considered at all. */
  considered: number;
  sample: PreviewSample[];
  /**
   * For an EVENT rule: this is hypothetical. Nothing has happened; it answers
   * "of the tickets open now, how many satisfy the conditions". The builder
   * says so, because "7 tickets match" would otherwise read as "7 alerts are
   * about to go out".
   */
  hypothetical: boolean;
  /** Tickets matching the conditions that the rule will NOT act on because
   *  their waiting began before it was written (`applyToExisting` off). */
  excludedAsExisting: number;
  /** The most common reason the non-matching tickets failed, which is
   *  usually the condition the operator got wrong. */
  topReason: string | null;
};

export async function previewRule(opts: {
  trigger: RuleTrigger;
  conditions: ConditionGroup;
  applyToExisting: boolean;
  /** Null when previewing an unsaved rule — then nothing is "existing". */
  createdAt: Date | null;
}): Promise<RulePreview> {
  const clock = await engineClock(new Date());

  const candidates = await candidateIds(opts.trigger);
  const facts = await loadFacts(
    candidates.map((c) => c.id),
    clock,
  );

  const sample: PreviewSample[] = [];
  const reasons = new Map<string, number>();
  let matches = 0;
  let excluded = 0;

  for (const candidate of candidates) {
    const sheet = facts.get(candidate.id);
    if (!sheet) continue;

    // The per-rule threshold the scanner leaves to the engine.
    if (opts.trigger.kind === "state") {
      if (!candidate.startedAt) continue;
      const waited = (clock.now.getTime() - candidate.startedAt.getTime()) / 60_000;
      if (waited < opts.trigger.minutes) continue;
    }

    const decision = evaluate(opts.conditions, sheet);
    if (!decision.matches) {
      reasons.set(decision.reason, (reasons.get(decision.reason) ?? 0) + 1);
      continue;
    }

    // Would the cold-start guard hold it back? Counted separately rather than
    // hidden, because this number is exactly what the "also apply to tickets
    // that are already waiting" tickbox is asking the operator about.
    if (
      !opts.applyToExisting &&
      opts.createdAt &&
      candidate.startedAt &&
      candidate.startedAt.getTime() < opts.createdAt.getTime()
    ) {
      excluded++;
      continue;
    }

    matches++;
    if (sample.length < SAMPLE_SIZE) {
      sample.push({
        id: sheet.ticket.id,
        ticketNumber: sheet.ticket.ticketNumber,
        subject: sheet.ticket.subject,
        priority: sheet.ticket.priority,
        status: sheet.ticket.status,
      });
    }
  }

  let topReason: string | null = null;
  let topCount = 0;
  for (const [reason, n] of reasons) {
    if (n > topCount) {
      topCount = n;
      topReason = reason;
    }
  }

  return {
    matches,
    capped: candidates.length >= SCAN_LIMIT,
    considered: candidates.length,
    sample,
    hypothetical: opts.trigger.kind === "event",
    excludedAsExisting: excluded,
    topReason,
  };
}

type Candidate = { id: string; startedAt: Date | null };

/**
 * Which tickets to consider.
 *
 * An event rule has no event to preview, so it falls back to every open
 * ticket — the honest answer to "which of today's tickets would satisfy these
 * conditions". A state rule reuses the scanner's own shape so the preview and
 * the engine cannot disagree about what counts as waiting.
 */
async function candidateIds(trigger: RuleTrigger): Promise<Candidate[]> {
  if (trigger.kind === "state") {
    const shape = STATE_TRIGGER_DEFS[trigger.state]?.shape;
    if (shape) {
      const { findStateCandidates } = await import("./scan");
      const { candidates } = await findStateCandidates([{ trigger }]);
      return candidates
        .slice(0, SCAN_LIMIT)
        .map((c) => ({ id: c.ticketId, startedAt: c.stateStartedAt ?? null }));
    }
  }

  const rows = await db
    .select({ id: tickets.id, createdAt: tickets.createdAt })
    .from(tickets)
    .where(
      and(
        isNull(tickets.deletedAt),
        ne(tickets.status, "resolved"),
        ne(tickets.status, "closed"),
        ne(tickets.status, "draft"),
      ),
    )
    .orderBy(desc(tickets.createdAt))
    .limit(SCAN_LIMIT);

  return rows.map((r) => ({ id: r.id, startedAt: r.createdAt }));
}

/** Open-ticket total, so the preview can say "7 of 143". */
export async function openTicketCount(): Promise<number> {
  const [row] = (
    await db.execute(
      sql`SELECT count(*)::int AS n FROM "tickets"
          WHERE "deleted_at" IS NULL
            AND "status" NOT IN ('resolved','closed','draft')`,
    )
  ).rows as { n: number }[];
  return Number(row?.n ?? 0);
}
