// ── The brain ─────────────────────────────────────────────────────────
//
// Two pure functions, no imports beyond the catalog and the types:
//
//   eventsFromDiff() — a raw column diff → the domain events it represents
//   evaluate()       — a rule + a FactSheet → does it match, and if not, why
//
// Both are import-free of anything impure so vitest can reach them (invariant
// I7). Everything that needs a database lives in facts.ts / engine.ts and is
// deliberately thin, because none of it is unit-testable here.

import {
  CONDITION_FIELDS,
  type ConditionFieldId,
  EVENT_TRIGGER_DEFS,
  isConditionFieldId,
} from "./catalog";
import {
  type Condition,
  type ConditionGroup,
  type ConditionNode,
  type ConditionOperator,
  type ConditionValue,
  type Decision,
  type EventTriggerId,
  type FactSheet,
  isGroup,
  UNARY_OPERATORS,
} from "./types";

// ── Raw change diffs → domain events ──────────────────────────────────

export type ColumnChange = { from: unknown; to: unknown };

export type MessageFacts = {
  authorType: string;
  isInternalNote: boolean;
  moderationStatus: string;
};

export type ChangeDiff = {
  op: "insert" | "update" | "message";
  /** Keyed by DATABASE column name, as the trigger records it. */
  changed: Record<string, ColumnChange>;
  message?: MessageFacts;
};

const PRIORITY_RANK: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function blank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function filled(v: unknown): boolean {
  return !blank(v);
}

/** Did a nullable timestamp column go from unset to set? */
function becameSet(c: ColumnChange | undefined): boolean {
  return c !== undefined && blank(c.from) && filled(c.to);
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Derive the domain events a raw diff represents.
 *
 * This is the whole translation layer between "the database says
 * assigned_to_id went from X to Y" and "somebody handed this ticket over".
 * Deliberately pure and exhaustively tested, because a mistake here is
 * invisible: the rule simply never fires, and nothing logs a reason.
 *
 * Two semantics worth stating because they are judgement calls, not
 * deductions:
 *
 *   • a reassignment emits BOTH `assigned` and `reassigned`. "When a ticket
 *     is assigned" reads, to an operator, as "when someone becomes its
 *     owner" — which a handover is. `reassigned` then exists for the narrower
 *     "when it changes hands" rule.
 *   • `resolved`/`closed` ALSO emit `status_changed`. One rule on the
 *     specific event and one on the general one will both fire; that is the
 *     operator's choice to make, not ours to silently narrow.
 */
export function eventsFromDiff(diff: ChangeDiff): EventTriggerId[] {
  const out: EventTriggerId[] = [];

  if (diff.op === "insert") return ["ticket.created"];

  if (diff.op === "message") {
    const m = diff.message;
    if (!m) return [];
    // A held reply is not yet part of the conversation, so it must not read as
    // a customer reply — that would restart follow-up clocks on a message
    // nobody has seen.
    if (m.moderationStatus === "held") return ["ticket.reply_held"];
    if (m.moderationStatus === "rejected") return [];
    // 'system' messages are bookkeeping, not conversation — AND this is a
    // loop guard with teeth: the engine's own `internal_note` action writes a
    // system note, which the messages trigger faithfully records. Without
    // this line that note would read as `note_added`, re-enter the engine,
    // and a rule whose trigger is "an internal note is added" and whose
    // action is "post an internal note" would run until something stopped it.
    // Checking authorType BEFORE isInternalNote is what makes that
    // impossible rather than merely unlikely.
    if (m.authorType === "system") return [];
    if (m.isInternalNote) return ["ticket.note_added"];
    if (m.authorType === "customer") return ["ticket.customer_replied"];
    if (m.authorType === "agent") return ["ticket.agent_replied"];
    return [];
  }

  const c = diff.changed;

  // ── Status ──
  if (c.status) {
    out.push("ticket.status_changed");
    if (c.status.to === "resolved") out.push("ticket.resolved");
    if (c.status.to === "closed") out.push("ticket.closed");
  }

  // ── Assignment ──
  if (c.assigned_to_id) {
    const had = filled(c.assigned_to_id.from);
    const has = filled(c.assigned_to_id.to);
    if (!had && has) out.push("ticket.assigned");
    else if (had && !has) out.push("ticket.unassigned");
    else if (had && has) out.push("ticket.assigned", "ticket.reassigned");
  }

  // ── Triage ──
  if (c.priority) {
    out.push("ticket.priority_changed");
    const before = PRIORITY_RANK[String(c.priority.from)];
    const after = PRIORITY_RANK[String(c.priority.to)];
    if (before !== undefined && after !== undefined && after > before) {
      out.push("ticket.priority_raised");
    }
  }
  if (c.category) out.push("ticket.category_changed");
  if (c.type) out.push("ticket.type_changed");
  if (c.service_type) out.push("ticket.service_type_changed");

  // ── Escalation ──
  if (c.is_escalated) {
    if (c.is_escalated.to === true) out.push("ticket.escalated");
    else if (c.is_escalated.to === false) out.push("ticket.deescalated");
  }

  // ── Reopen ──
  if (c.reopened_count) {
    const before = num(c.reopened_count.from) ?? 0;
    const after = num(c.reopened_count.to) ?? 0;
    if (after > before) out.push("ticket.reopened");
  }

  // ── SLA stamps ──
  if (becameSet(c.first_response_at)) out.push("ticket.first_response");
  if (becameSet(c.sla_warning_50_at)) out.push("ticket.sla_warning_50");
  if (becameSet(c.sla_warning_80_at)) out.push("ticket.sla_warning_80");
  if (becameSet(c.sla_breached_at)) out.push("ticket.sla_breached");

  // ── CSAT ──
  if (c.csat_rating && filled(c.csat_rating.to)) out.push("ticket.csat_received");

  // ── Billing ──
  if (c.billable && filled(c.billable.to)) out.push("ticket.billable_set");
  if (c.invoice_number && filled(c.invoice_number.to)) {
    out.push("ticket.invoice_set");
  }

  // ── Organization ──
  if (c.org_match_status) {
    const to = String(c.org_match_status.to);
    if (to === "account" || to === "domain" || to === "staff") {
      out.push("ticket.org_matched");
    } else if (to === "unverified") {
      out.push("ticket.org_unverified");
    }
  } else if (c.organization_id && filled(c.organization_id.to)) {
    // The org was linked without the match status moving — still a match.
    out.push("ticket.org_matched");
  }

  // De-dupe while preserving order: `assigned_to_id` can push `assigned`
  // twice if a future branch is added carelessly.
  return [...new Set(out)];
}

/** Which columns a given event needs recorded. Used by the catalog test to
 *  prove every event is reachable through WATCHED_COLUMNS. */
export function columnsForEvent(event: EventTriggerId): readonly string[] {
  const src = EVENT_TRIGGER_DEFS[event].source;
  return typeof src === "string" ? [] : src.columns;
}

// ── Condition evaluation ──────────────────────────────────────────────

function asList(v: ConditionValue | undefined): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (v === null || v === undefined) return [];
  return [String(v)];
}

function emptyFact(fact: ConditionValue): boolean {
  if (Array.isArray(fact)) return fact.length === 0;
  return blank(fact);
}

/**
 * Compare one fact against one operator and value.
 *
 * The null policy is the important part and it is deliberately conservative:
 * a missing fact NEVER satisfies a comparison. "No customer reply for more
 * than 60 minutes" must not match a ticket the customer has never written on
 * — there is no elapsed time to compare, and treating null as 0 or as
 * Infinity would both produce a confidently wrong answer. Operators who want
 * "never replied" express it with `is_empty`.
 */
export function compare(
  fact: ConditionValue,
  operator: ConditionOperator,
  value: ConditionValue | undefined,
  multi: boolean,
): boolean {
  if (operator === "is_empty") return emptyFact(fact);
  if (operator === "is_not_empty") return !emptyFact(fact);

  // A set-valued fact (today only `assignee_role`): equality means membership.
  if (multi) {
    const set = new Set(asList(fact).map((s) => s.toLowerCase()));
    const wanted = asList(value).map((s) => s.toLowerCase());
    switch (operator) {
      case "is":
      case "is_one_of":
        return wanted.some((w) => set.has(w));
      case "is_not":
      case "is_not_one_of":
        return wanted.length > 0 && !wanted.some((w) => set.has(w));
      case "contains":
        return wanted.some((w) => [...set].some((s) => s.includes(w)));
      case "not_contains":
        return !wanted.some((w) => [...set].some((s) => s.includes(w)));
      default:
        return false;
    }
  }

  if (operator === "is_one_of" || operator === "is_not_one_of") {
    const hit =
      !emptyFact(fact) &&
      asList(value)
        .map((s) => s.toLowerCase())
        .includes(String(fact).toLowerCase());
    return operator === "is_one_of" ? hit : !hit;
  }

  switch (operator) {
    case "is":
    case "is_not": {
      let hit: boolean;
      if (typeof fact === "boolean" || typeof value === "boolean") {
        // Checkbox-shaped conditions: the stored value may be the string
        // "true" after a JSON round-trip through the form.
        hit = Boolean(fact) === (value === true || value === "true");
      } else if (emptyFact(fact)) {
        hit = emptyFact(value ?? null);
      } else {
        hit = String(fact).toLowerCase() === String(value ?? "").toLowerCase();
      }
      return operator === "is" ? hit : !hit;
    }
    case "contains":
    case "not_contains": {
      const hay = emptyFact(fact) ? "" : String(fact).toLowerCase();
      const needle = String(value ?? "").toLowerCase();
      if (needle === "") return operator === "not_contains";
      const hit = hay.includes(needle);
      return operator === "contains" ? hit : !hit;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = num(fact);
      const b = num(value ?? null);
      if (a === null || b === null) return false;
      if (operator === "gt") return a > b;
      if (operator === "gte") return a >= b;
      if (operator === "lt") return a < b;
      return a <= b;
    }
    default:
      return false;
  }
}

function evalCondition(
  cond: Condition,
  facts: FactSheet,
): { ok: boolean; reason: string } {
  if (!isConditionFieldId(cond.field)) {
    // A rule saved before a field was renamed or removed. Fail CLOSED and say
    // so — a condition that silently evaluates true would make the rule fire
    // more widely than its author ever asked for (invariant I5).
    return { ok: false, reason: `unknown field "${cond.field}"` };
  }
  const def = CONDITION_FIELDS[cond.field as ConditionFieldId];
  if (!def.operators.includes(cond.operator)) {
    return {
      ok: false,
      reason: `"${cond.operator}" cannot be used on "${cond.field}"`,
    };
  }
  if (
    !UNARY_OPERATORS.has(cond.operator) &&
    cond.value === undefined &&
    def.valueType !== "boolean"
  ) {
    return { ok: false, reason: `"${cond.field}" has no value set` };
  }

  const fact = def.read(facts);
  const ok = compare(
    fact,
    cond.operator,
    cond.value,
    def.multi === true,
  );
  return {
    ok,
    reason: ok
      ? ""
      : `${cond.field} ${cond.operator} ${describeValue(cond.value)} — it is ${describeValue(fact)}`,
  };
}

function describeValue(v: ConditionValue | undefined): string {
  if (v === undefined || v === null) return "not set";
  if (Array.isArray(v)) return v.length === 0 ? "nothing" : v.join(" or ");
  if (v === "") return "empty";
  return String(v);
}

function evalNode(
  node: ConditionNode,
  facts: FactSheet,
  path: string,
): { ok: boolean; reason: string; failedAt: string | null } {
  if (!isGroup(node)) {
    const r = evalCondition(node, facts);
    return { ok: r.ok, reason: r.reason, failedAt: r.ok ? null : path };
  }

  // An empty group is TRUE. A rule with no conditions fires on every trigger,
  // which is both the natural reading and the only way to express "whenever
  // this happens, no exceptions".
  if (node.conditions.length === 0) return { ok: true, reason: "", failedAt: null };

  if (node.combinator === "all") {
    for (let i = 0; i < node.conditions.length; i++) {
      const child = node.conditions[i];
      if (!child) continue;
      const r = evalNode(child, facts, `${path}.${i}`);
      if (!r.ok) return r;
    }
    return { ok: true, reason: "", failedAt: null };
  }

  // "any": report the first child's reason, which is the most useful single
  // explanation of why nothing in the group matched.
  let first: { reason: string; failedAt: string | null } | null = null;
  for (let i = 0; i < node.conditions.length; i++) {
    const child = node.conditions[i];
    if (!child) continue;
    const r = evalNode(child, facts, `${path}.${i}`);
    if (r.ok) return { ok: true, reason: "", failedAt: null };
    if (!first) first = { reason: r.reason, failedAt: r.failedAt };
  }
  return {
    ok: false,
    reason: first ? `none of these held: ${first.reason}` : "no conditions held",
    failedAt: first?.failedAt ?? path,
  };
}

/**
 * Does this rule's condition tree hold for this ticket?
 *
 * Trigger matching, dedupe and the action budget are NOT checked here — they
 * need state this function deliberately cannot see. This answers exactly one
 * question, which is what makes it testable.
 */
export function evaluate(
  conditions: ConditionGroup,
  facts: FactSheet,
): Decision {
  const r = evalNode(conditions, facts, "root");
  return r.ok ? { matches: true } : { matches: false, reason: r.reason, failedAt: r.failedAt };
}
