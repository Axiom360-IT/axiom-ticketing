// ── Automation rules: the shapes ──────────────────────────────────────
//
// Pure types, no imports beyond the weekday vocabulary. Everything the
// evaluator touches is declared here so `evaluate.ts` can stay import-free
// and therefore testable (see docs/automation-rules.md, invariant I7).
//
// The three trigger families are not cosmetic. An `event` rule fires because
// a column changed; a `state` rule fires because something has BEEN true for
// a while — nothing happens at minute 30 of "unassigned for 30 minutes", so
// it needs a scanner rather than a feed; a `schedule` rule fires on a clock.
// Conflating them is the classic way a rule engine ends up unable to express
// half of what operators ask for.

import type { Weekday } from "@/lib/automations/schedule";

// ── Triggers ──────────────────────────────────────────────────────────

export const EVENT_TRIGGERS = [
  "ticket.created",
  "ticket.status_changed",
  "ticket.assigned",
  "ticket.unassigned",
  "ticket.reassigned",
  "ticket.priority_changed",
  "ticket.priority_raised",
  "ticket.category_changed",
  "ticket.type_changed",
  "ticket.service_type_changed",
  "ticket.escalated",
  "ticket.deescalated",
  "ticket.resolved",
  "ticket.reopened",
  "ticket.closed",
  "ticket.first_response",
  "ticket.csat_received",
  "ticket.sla_warning_50",
  "ticket.sla_warning_80",
  "ticket.sla_breached",
  "ticket.billable_set",
  "ticket.invoice_set",
  "ticket.org_matched",
  "ticket.org_unverified",
  "ticket.customer_replied",
  "ticket.agent_replied",
  "ticket.note_added",
  "ticket.reply_held",
] as const;

export type EventTriggerId = (typeof EVENT_TRIGGERS)[number];

export const STATE_TRIGGERS = [
  "unassigned_for",
  "in_status_for",
  "no_first_response_for",
  "no_customer_reply_for",
  "no_agent_reply_for",
  "resolved_without_csat_for",
  "past_resolution_due_by",
  "open_for",
  "no_work_logged_for",
] as const;

export type StateTriggerId = (typeof STATE_TRIGGERS)[number];

export type RuleTrigger =
  | { kind: "event"; event: EventTriggerId }
  /** `minutes` is how long the state must have held. The scanner re-checks
   *  every pass, so the dedupe policy is what stops it re-firing. */
  | { kind: "state"; state: StateTriggerId; minutes: number }
  /** Local wall-clock, in `business_hours.timezone` — same vocabulary and
   *  same timezone source as `scheduled_reports`. */
  | { kind: "schedule"; hour: number; minute: number; weekdays: Weekday[] };

export type TriggerKind = RuleTrigger["kind"];

// ── Conditions ────────────────────────────────────────────────────────

export const CONDITION_OPERATORS = [
  "is",
  "is_not",
  "is_one_of",
  "is_not_one_of",
  "is_empty",
  "is_not_empty",
  "contains",
  "not_contains",
  "gt",
  "gte",
  "lt",
  "lte",
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

/** Operators that take no `value` — the UI hides the value box for these. */
export const UNARY_OPERATORS: ReadonlySet<ConditionOperator> = new Set([
  "is_empty",
  "is_not_empty",
]);

/** Operators whose `value` is a list rather than a scalar. */
export const LIST_OPERATORS: ReadonlySet<ConditionOperator> = new Set([
  "is_one_of",
  "is_not_one_of",
]);

export type ConditionValue = string | number | boolean | string[] | null;

export type Condition = {
  field: string;
  operator: ConditionOperator;
  value?: ConditionValue;
};

export type ConditionGroup = {
  combinator: "all" | "any";
  conditions: ConditionNode[];
};

export type ConditionNode = Condition | ConditionGroup;

export function isGroup(node: ConditionNode): node is ConditionGroup {
  return "combinator" in node;
}

// ── Actions ───────────────────────────────────────────────────────────
//
// Phase 1 ships SAFE actions only: they inform, they do not mutate a ticket.
// `ACTION_IS_MUTATING` is the gate — the executor refuses a mutating action
// while the engine is in safe mode, so the catalog can describe the full set
// without the engine being able to perform it yet.

export const ACTION_TYPES = [
  // ── Safe ──
  "notify",
  "internal_note",
  "flag",
  "webhook",
  // ── Mutating (later phase; declared, gated) ──
  "assign",
  "add_coassignee",
  "set_priority",
  "set_category",
  "set_type",
  "set_service_type",
  "set_billable",
  "escalate",
  "pause_sla",
  "resume_sla",
  "add_participant",
  "resolve",
  "close",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export const MUTATING_ACTIONS: ReadonlySet<ActionType> = new Set([
  "assign",
  "add_coassignee",
  "set_priority",
  "set_category",
  "set_type",
  "set_service_type",
  "set_billable",
  "escalate",
  "pause_sla",
  "resume_sla",
  "add_participant",
  "resolve",
  "close",
]);

export const NOTIFY_CHANNELS = ["in_app", "email", "sms"] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];

/** Who a notify action reaches. Resolved at run time, never at save time —
 *  "the IT Director" must keep working across a handover (invariant I5). */
export const NOTIFY_AUDIENCES = [
  "assignee",
  "customer",
  "org_trusted_contacts",
  "participants",
  "escalation_target_role",
  "named_users",
  "named_roles",
  "named_emails",
] as const;

export type NotifyAudience = (typeof NOTIFY_AUDIENCES)[number];

export type RuleAction =
  | {
      type: "notify";
      channels: NotifyChannel[];
      audiences: NotifyAudience[];
      userIds?: string[];
      roles?: string[];
      emails?: string[];
      /** Operator-written. Placeholders are substituted by `render.ts`. */
      subject?: string;
      body: string;
    }
  | { type: "internal_note"; body: string }
  | { type: "flag"; reason: string }
  | { type: "webhook"; url: string; secret?: string }
  | { type: "assign"; mode: "user" | "least_loaded_in_role"; userId?: string; role?: string }
  | { type: "add_coassignee"; userId: string }
  | { type: "set_priority"; value: string }
  | { type: "set_category"; value: string }
  | { type: "set_type"; value: string }
  | { type: "set_service_type"; value: string }
  | { type: "set_billable"; value: string }
  | { type: "escalate"; reason: string; targetRole: string; note?: string }
  | { type: "pause_sla" }
  | { type: "resume_sla" }
  | { type: "add_participant"; email: string }
  | { type: "resolve"; note?: string }
  | { type: "close" };

// ── Dedupe ────────────────────────────────────────────────────────────

export const DEDUPE_POLICIES = [
  "always",
  "once_per_ticket",
  "once_per_occurrence",
  "throttle",
] as const;

export type DedupePolicy = (typeof DEDUPE_POLICIES)[number];

export type RuleDedupe = {
  policy: DedupePolicy;
  /** Only read when policy is `throttle`. */
  throttleMinutes?: number;
};

// ── The rule ──────────────────────────────────────────────────────────

export type AutomationRule = {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  /** Lower runs first. Ties broken by `createdAt` so order is total. */
  order: number;
  trigger: RuleTrigger;
  conditions: ConditionGroup;
  actions: RuleAction[];
  dedupe: RuleDedupe;
  /** Prevent later rules running for this ticket once this one matches. */
  stopOnMatch: boolean;
  /** Allow this rule to fire on changes that another rule caused. Off by
   *  default — this is half of the loop guard (invariant I1). */
  allowChaining: boolean;
  /**
   * Let a `state` rule reach back over tickets whose waiting began BEFORE the
   * rule was written. Off by default, and the default is the important part.
   *
   * Saving "alert me when a ticket has been open for a week" would otherwise
   * fire for the entire existing backlog in its first pass. Worse, there is no
   * `status_changed_at` column, so for any ticket that has not moved since the
   * engine was installed `minutes_in_status` falls back to the ticket's age —
   * which over-reports the wait and makes that first blast larger still.
   *
   * With this off, the cutoff is the rule's own `createdAt`. The preview tells
   * the operator how many existing tickets they are choosing to exclude, so
   * the safe default is an informed one rather than a surprise.
   */
  applyToExisting: boolean;
  /** Set when a referent vanished. Non-null means the rule is skipped and the
   *  card shows why. Never silently no-ops (invariant I5). */
  brokenReason: string | null;
};

// ── Facts ─────────────────────────────────────────────────────────────
//
// The complete snapshot the evaluator sees. Built once per ticket per run by
// `facts.ts`; the evaluator never queries anything itself.

export type TicketFacts = {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string;
  category: string;
  type: string;
  serviceType: string;
  priority: string;
  status: string;
  stream: string;
  origin: string;
  createdVia: string | null;
  organizationId: string | null;
  customerEmail: string;
  customerDomain: string | null;
  orgMatchStatus: string;
  billable: string | null;
  invoiceNumber: string | null;
  assignedToId: string | null;
  isEscalated: boolean;
  escalationReason: string | null;
  escalationTargetRole: string | null;
  csatRating: string | null;
  reopenedCount: number;
  firstResponseAt: Date | null;
  resolutionDueAt: Date | null;
  slaBreachedAt: Date | null;
  slaPausedAt: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type OrgFacts = {
  id: string;
  name: string;
  isInternal: boolean;
  isMonthlyPlan: boolean;
  monthlyMinutesBalance: number | null;
};

export type AssigneeFacts = {
  id: string;
  roleNames: string[];
  isActive: boolean;
};

export type FactSheet = {
  ticket: TicketFacts;
  organization: OrgFacts | null;
  assignee: AssigneeFacts | null;
  counts: {
    participants: number;
    publicMessages: number;
    attachments: number;
    workLogMinutes: number;
  };
  /** Minutes, computed against the run's `now` so every rule in a pass sees
   *  one consistent clock. */
  timing: {
    ageMinutes: number;
    minutesInStatus: number;
    minutesSinceLastCustomerMessage: number | null;
    minutesSinceLastAgentMessage: number | null;
    minutesSinceAssigned: number | null;
    minutesPastResolutionDue: number | null;
  };
  /** Local wall-clock facts, in `business_hours.timezone`. */
  local: {
    weekday: Weekday;
    hour: number;
    minute: number;
    insideBusinessHours: boolean;
    isHoliday: boolean;
  };
};

// ── Evaluation result ─────────────────────────────────────────────────

export type Decision =
  | { matches: true }
  /** `failedAt` is a human-readable path to the condition that failed —
   *  this is what powers the "why didn't my rule fire?" log. */
  | { matches: false; reason: string; failedAt: string | null };

// ── Engine limits (invariant I2) ──────────────────────────────────────

export const MAX_MATCHES_PER_RUN = 200;
export const MAX_CHAIN_DEPTH = 3;
export const MAX_ACTIONS_PER_RULE = 10;
export const MAX_CONDITIONS_PER_RULE = 25;
/** Per rule, per rolling hour, across every ticket. Trips the rule to paused
 *  rather than continuing — a mis-written rule costs one hour, not a day. */
export const DEFAULT_HOURLY_ACTION_BUDGET = 200;
