// ── The catalog ───────────────────────────────────────────────────────
//
// Every trigger, condition field and action the engine understands, in one
// place, with the pure accessor that reads each field out of a FactSheet.
//
// The accessor lives HERE rather than in the evaluator on purpose. The records
// below are typed as exhaustive `Record<Id, Def>`, so TypeScript refuses to
// compile a catalog entry that has no way to be read or no way to be run.
// That makes invariant I8 ("the catalog cannot lie") structural rather than
// something a test has to remember to check — the test only has to cover what
// the compiler cannot see, which is the English wording in en.json.
//
// Nothing here imports anything impure. `clientCatalog()` strips the functions
// so the whole thing can cross to the browser for the rule builder.

import { WEEKDAYS } from "@/lib/automations/schedule";
import {
  type ActionType,
  ACTION_TYPES,
  type ConditionOperator,
  type ConditionValue,
  type EventTriggerId,
  EVENT_TRIGGERS,
  type FactSheet,
  MUTATING_ACTIONS,
  type StateTriggerId,
  STATE_TRIGGERS,
} from "./types";

// ── Value shapes ──────────────────────────────────────────────────────

export type FieldValueType =
  /** A fixed vocabulary, listed in `options`. */
  | "enum"
  /** A vocabulary only the server knows (users, roles, orgs, categories).
   *  The builder loads these; the catalog only names which kind. */
  | "reference"
  | "text"
  | "number"
  | "boolean";

export type ReferenceKind =
  | "user"
  | "role"
  | "organization"
  | "category"
  | "ticket_type";

export type FieldGroup =
  | "ticket"
  | "people"
  | "organization"
  | "sla"
  | "timing"
  | "work";

const ENUM_OPS: ConditionOperator[] = [
  "is",
  "is_not",
  "is_one_of",
  "is_not_one_of",
  "is_empty",
  "is_not_empty",
];

const TEXT_OPS: ConditionOperator[] = [
  "contains",
  "not_contains",
  "is",
  "is_not",
  "is_empty",
  "is_not_empty",
];

const NUMBER_OPS: ConditionOperator[] = [
  "gte",
  "lte",
  "gt",
  "lt",
  "is",
  "is_not",
];

const BOOL_OPS: ConditionOperator[] = ["is"];

// ── The vocabularies, as the CHECK constraints define them ────────────
//
// Kept in step with src/lib/db/schema/tickets.ts by catalog.test.ts, which
// reads the schema source and compares. A rule offering a priority the column
// rejects would be saveable and permanently unmatchable.

export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export const STATUSES = [
  "draft",
  "open",
  "in_progress",
  "awaiting_customer_confirmation",
  "on_hold",
  "escalation",
  "resolved",
  "closed",
] as const;
export const SERVICE_TYPES = ["onsite", "remote", "hybrid"] as const;
export const STREAMS = ["internal", "external"] as const;
export const ORIGINS = ["web_form", "email", "portal"] as const;
export const CREATED_VIA = [
  "direct_email",
  "forwarded_email",
  "manual",
  "portal",
  "web_form",
] as const;
export const ORG_MATCH_STATUSES = [
  "account",
  "domain",
  "staff",
  "unverified",
  "none",
] as const;
export const BILLABLE_TIERS = [
  "hourly_regular",
  "hourly_premium",
  "no",
  "monthly_plan",
  "project",
  "rework",
] as const;
export const CSAT_RATINGS = ["happy", "neutral", "unhappy"] as const;
export const ESCALATION_REASONS = [
  "beyond_scope",
  "requires_access",
  "critical_impact",
  "vendor_involvement",
  "other",
] as const;
/** Derived, not a column — see the `sla_state` reader below. */
export const SLA_STATES = [
  "ok",
  "warning_50",
  "warning_80",
  "breached",
  "paused",
] as const;

// ── Condition fields ──────────────────────────────────────────────────

export const CONDITION_FIELDS_IDS = [
  // ticket
  "priority",
  "status",
  "category",
  "type",
  "service_type",
  "stream",
  "origin",
  "created_via",
  "subject",
  "description",
  "billable",
  "invoice_number",
  "reopened_count",
  "csat_rating",
  // people
  "assignee",
  "assignee_role",
  "customer_email",
  "customer_domain",
  "participant_count",
  // organization
  "organization",
  "org_match_status",
  "org_is_internal",
  "org_monthly_balance_minutes",
  // sla
  "sla_state",
  "is_escalated",
  "escalation_reason",
  "escalation_target_role",
  "first_response_received",
  "minutes_past_resolution_due",
  // timing
  "age_minutes",
  "minutes_in_status",
  "minutes_since_customer_message",
  "minutes_since_agent_message",
  "minutes_since_assigned",
  "inside_business_hours",
  "is_holiday",
  "weekday",
  "hour_of_day",
  // work
  "work_log_minutes",
  "attachment_count",
  "public_message_count",
] as const;

export type ConditionFieldId = (typeof CONDITION_FIELDS_IDS)[number];

export type ConditionFieldDef = {
  group: FieldGroup;
  valueType: FieldValueType;
  operators: ConditionOperator[];
  /** Present when valueType is "enum". */
  options?: readonly string[];
  /** Present when valueType is "reference". */
  reference?: ReferenceKind;
  /** Unit hint, so the builder can say "minutes" beside a number box. */
  unit?: "minutes" | "hours" | "days";
  /** True when the fact is a SET rather than a scalar — `is X` then means
   *  "the set contains X". Only `assignee_role` today. */
  multi?: true;
  /** Pure accessor. The only way the evaluator reads a field. */
  read: (f: FactSheet) => ConditionValue;
};

function domainOf(email: string | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  return at === -1 ? null : email.slice(at + 1).toLowerCase();
}

export const CONDITION_FIELDS: Record<ConditionFieldId, ConditionFieldDef> = {
  // ── Ticket ──────────────────────────────────────────────────────────
  priority: {
    group: "ticket",
    valueType: "enum",
    options: PRIORITIES,
    operators: ENUM_OPS,
    read: (f) => f.ticket.priority,
  },
  status: {
    group: "ticket",
    valueType: "enum",
    options: STATUSES,
    operators: ENUM_OPS,
    read: (f) => f.ticket.status,
  },
  category: {
    group: "ticket",
    valueType: "reference",
    reference: "category",
    operators: ENUM_OPS,
    read: (f) => f.ticket.category,
  },
  type: {
    group: "ticket",
    valueType: "reference",
    reference: "ticket_type",
    operators: ENUM_OPS,
    read: (f) => f.ticket.type,
  },
  service_type: {
    group: "ticket",
    valueType: "enum",
    options: SERVICE_TYPES,
    operators: ENUM_OPS,
    read: (f) => f.ticket.serviceType,
  },
  stream: {
    group: "ticket",
    valueType: "enum",
    options: STREAMS,
    operators: ENUM_OPS,
    read: (f) => f.ticket.stream,
  },
  origin: {
    group: "ticket",
    valueType: "enum",
    options: ORIGINS,
    operators: ENUM_OPS,
    read: (f) => f.ticket.origin,
  },
  created_via: {
    group: "ticket",
    valueType: "enum",
    options: CREATED_VIA,
    operators: ENUM_OPS,
    read: (f) => f.ticket.createdVia,
  },
  subject: {
    group: "ticket",
    valueType: "text",
    operators: TEXT_OPS,
    read: (f) => f.ticket.subject,
  },
  description: {
    group: "ticket",
    valueType: "text",
    operators: TEXT_OPS,
    read: (f) => f.ticket.description,
  },
  billable: {
    group: "ticket",
    valueType: "enum",
    options: BILLABLE_TIERS,
    operators: ENUM_OPS,
    read: (f) => f.ticket.billable,
  },
  invoice_number: {
    group: "ticket",
    valueType: "text",
    operators: TEXT_OPS,
    read: (f) => f.ticket.invoiceNumber,
  },
  reopened_count: {
    group: "ticket",
    valueType: "number",
    operators: NUMBER_OPS,
    read: (f) => f.ticket.reopenedCount,
  },
  csat_rating: {
    group: "ticket",
    valueType: "enum",
    options: CSAT_RATINGS,
    operators: ENUM_OPS,
    read: (f) => f.ticket.csatRating,
  },

  // ── People ──────────────────────────────────────────────────────────
  assignee: {
    group: "people",
    valueType: "reference",
    reference: "user",
    operators: ENUM_OPS,
    read: (f) => f.ticket.assignedToId,
  },
  assignee_role: {
    group: "people",
    valueType: "reference",
    reference: "role",
    operators: ENUM_OPS,
    multi: true,
    read: (f) => f.assignee?.roleNames ?? [],
  },
  customer_email: {
    group: "people",
    valueType: "text",
    operators: TEXT_OPS,
    read: (f) => f.ticket.customerEmail,
  },
  customer_domain: {
    group: "people",
    valueType: "text",
    operators: TEXT_OPS,
    read: (f) => f.ticket.customerDomain ?? domainOf(f.ticket.customerEmail),
  },
  participant_count: {
    group: "people",
    valueType: "number",
    operators: NUMBER_OPS,
    read: (f) => f.counts.participants,
  },

  // ── Organization ────────────────────────────────────────────────────
  organization: {
    group: "organization",
    valueType: "reference",
    reference: "organization",
    operators: ENUM_OPS,
    read: (f) => f.ticket.organizationId,
  },
  org_match_status: {
    group: "organization",
    valueType: "enum",
    options: ORG_MATCH_STATUSES,
    operators: ENUM_OPS,
    read: (f) => f.ticket.orgMatchStatus,
  },
  org_is_internal: {
    group: "organization",
    valueType: "boolean",
    operators: BOOL_OPS,
    read: (f) => f.organization?.isInternal ?? false,
  },
  org_monthly_balance_minutes: {
    group: "organization",
    valueType: "number",
    operators: NUMBER_OPS,
    unit: "minutes",
    read: (f) => f.organization?.monthlyMinutesBalance ?? null,
  },

  // ── SLA ─────────────────────────────────────────────────────────────
  sla_state: {
    group: "sla",
    valueType: "enum",
    options: SLA_STATES,
    operators: ENUM_OPS,
    // Derived, and deliberately ordered most-severe-first: a breached ticket
    // that is now paused reads as "paused", because that is the state an
    // operator would act on.
    read: (f) => {
      const t = f.ticket;
      if (t.slaPausedAt) return "paused";
      if (t.slaBreachedAt) return "breached";
      const past = f.timing.minutesPastResolutionDue;
      if (past !== null && past >= 0) return "breached";
      if (!t.resolutionDueAt) return "ok";
      const total = t.resolutionDueAt.getTime() - t.createdAt.getTime();
      if (total <= 0) return "ok";
      const elapsed = f.timing.ageMinutes * 60_000;
      const pct = elapsed / total;
      if (pct >= 0.8) return "warning_80";
      if (pct >= 0.5) return "warning_50";
      return "ok";
    },
  },
  is_escalated: {
    group: "sla",
    valueType: "boolean",
    operators: BOOL_OPS,
    read: (f) => f.ticket.isEscalated,
  },
  escalation_reason: {
    group: "sla",
    valueType: "enum",
    options: ESCALATION_REASONS,
    operators: ENUM_OPS,
    read: (f) => f.ticket.escalationReason,
  },
  escalation_target_role: {
    group: "sla",
    valueType: "reference",
    reference: "role",
    operators: ENUM_OPS,
    read: (f) => f.ticket.escalationTargetRole,
  },
  first_response_received: {
    group: "sla",
    valueType: "boolean",
    operators: BOOL_OPS,
    read: (f) => f.ticket.firstResponseAt !== null,
  },
  minutes_past_resolution_due: {
    group: "sla",
    valueType: "number",
    operators: NUMBER_OPS,
    unit: "minutes",
    read: (f) => f.timing.minutesPastResolutionDue,
  },

  // ── Timing ──────────────────────────────────────────────────────────
  age_minutes: {
    group: "timing",
    valueType: "number",
    operators: NUMBER_OPS,
    unit: "minutes",
    read: (f) => f.timing.ageMinutes,
  },
  minutes_in_status: {
    group: "timing",
    valueType: "number",
    operators: NUMBER_OPS,
    unit: "minutes",
    read: (f) => f.timing.minutesInStatus,
  },
  minutes_since_customer_message: {
    group: "timing",
    valueType: "number",
    operators: NUMBER_OPS,
    unit: "minutes",
    read: (f) => f.timing.minutesSinceLastCustomerMessage,
  },
  minutes_since_agent_message: {
    group: "timing",
    valueType: "number",
    operators: NUMBER_OPS,
    unit: "minutes",
    read: (f) => f.timing.minutesSinceLastAgentMessage,
  },
  minutes_since_assigned: {
    group: "timing",
    valueType: "number",
    operators: NUMBER_OPS,
    unit: "minutes",
    read: (f) => f.timing.minutesSinceAssigned,
  },
  inside_business_hours: {
    group: "timing",
    valueType: "boolean",
    operators: BOOL_OPS,
    read: (f) => f.local.insideBusinessHours,
  },
  is_holiday: {
    group: "timing",
    valueType: "boolean",
    operators: BOOL_OPS,
    read: (f) => f.local.isHoliday,
  },
  weekday: {
    group: "timing",
    valueType: "enum",
    options: WEEKDAYS,
    operators: ENUM_OPS,
    read: (f) => f.local.weekday,
  },
  hour_of_day: {
    group: "timing",
    valueType: "number",
    operators: NUMBER_OPS,
    read: (f) => f.local.hour,
  },

  // ── Work ────────────────────────────────────────────────────────────
  work_log_minutes: {
    group: "work",
    valueType: "number",
    operators: NUMBER_OPS,
    unit: "minutes",
    read: (f) => f.counts.workLogMinutes,
  },
  attachment_count: {
    group: "work",
    valueType: "number",
    operators: NUMBER_OPS,
    read: (f) => f.counts.attachments,
  },
  public_message_count: {
    group: "work",
    valueType: "number",
    operators: NUMBER_OPS,
    read: (f) => f.counts.publicMessages,
  },
};

export function isConditionFieldId(v: unknown): v is ConditionFieldId {
  return typeof v === "string" && v in CONDITION_FIELDS;
}

// ── Triggers ──────────────────────────────────────────────────────────

export type EventTriggerDef = {
  /** Which ticket columns must have changed for this to fire, or "insert",
   *  or "message" when it comes from the messages feed instead.
   *
   *  This is what `changefeed.ts` matches against, and it is also the list
   *  that `WATCHED_COLUMNS` must cover — a trigger watching a column the
   *  database trigger does not record could never fire. catalog.test.ts
   *  asserts the containment. */
  source: "insert" | "message" | { columns: readonly string[] };
  /** Conditions the raw diff must satisfy, beyond "this column changed".
   *  Pure, and evaluated on the diff rather than on the FactSheet. */
  category: "lifecycle" | "assignment" | "triage" | "sla" | "conversation" | "billing";
};

export const EVENT_TRIGGER_DEFS: Record<EventTriggerId, EventTriggerDef> = {
  "ticket.created": { source: "insert", category: "lifecycle" },
  "ticket.status_changed": { source: { columns: ["status"] }, category: "lifecycle" },
  "ticket.assigned": { source: { columns: ["assigned_to_id"] }, category: "assignment" },
  "ticket.unassigned": { source: { columns: ["assigned_to_id"] }, category: "assignment" },
  "ticket.reassigned": { source: { columns: ["assigned_to_id"] }, category: "assignment" },
  "ticket.priority_changed": { source: { columns: ["priority"] }, category: "triage" },
  "ticket.priority_raised": { source: { columns: ["priority"] }, category: "triage" },
  "ticket.category_changed": { source: { columns: ["category"] }, category: "triage" },
  "ticket.type_changed": { source: { columns: ["type"] }, category: "triage" },
  "ticket.service_type_changed": {
    source: { columns: ["service_type"] },
    category: "triage",
  },
  "ticket.escalated": { source: { columns: ["is_escalated"] }, category: "sla" },
  "ticket.deescalated": { source: { columns: ["is_escalated"] }, category: "sla" },
  "ticket.resolved": { source: { columns: ["status"] }, category: "lifecycle" },
  "ticket.reopened": { source: { columns: ["reopened_count"] }, category: "lifecycle" },
  "ticket.closed": { source: { columns: ["status"] }, category: "lifecycle" },
  "ticket.first_response": {
    source: { columns: ["first_response_at"] },
    category: "sla",
  },
  "ticket.csat_received": { source: { columns: ["csat_rating"] }, category: "lifecycle" },
  "ticket.sla_warning_50": {
    source: { columns: ["sla_warning_50_at"] },
    category: "sla",
  },
  "ticket.sla_warning_80": {
    source: { columns: ["sla_warning_80_at"] },
    category: "sla",
  },
  "ticket.sla_breached": { source: { columns: ["sla_breached_at"] }, category: "sla" },
  "ticket.billable_set": { source: { columns: ["billable"] }, category: "billing" },
  "ticket.invoice_set": { source: { columns: ["invoice_number"] }, category: "billing" },
  "ticket.org_matched": {
    source: { columns: ["organization_id", "org_match_status"] },
    category: "triage",
  },
  "ticket.org_unverified": {
    source: { columns: ["org_match_status"] },
    category: "triage",
  },
  "ticket.customer_replied": { source: "message", category: "conversation" },
  "ticket.agent_replied": { source: "message", category: "conversation" },
  "ticket.note_added": { source: "message", category: "conversation" },
  "ticket.reply_held": { source: "message", category: "conversation" },
};

export type StateTriggerDef = {
  /** Default threshold shown in the builder. */
  defaultMinutes: number;
  /** The fact the scanner's SQL must look at, for documentation and so the
   *  scanner can group rules by shape (invariant I10). */
  shape:
    | "unassigned"
    | "status_age"
    | "no_first_response"
    | "no_customer_reply"
    | "no_agent_reply"
    | "resolved_no_csat"
    | "past_due"
    | "open_age"
    | "no_work_logged";
};

export const STATE_TRIGGER_DEFS: Record<StateTriggerId, StateTriggerDef> = {
  unassigned_for: { defaultMinutes: 30, shape: "unassigned" },
  in_status_for: { defaultMinutes: 1440, shape: "status_age" },
  no_first_response_for: { defaultMinutes: 60, shape: "no_first_response" },
  no_customer_reply_for: { defaultMinutes: 4320, shape: "no_customer_reply" },
  no_agent_reply_for: { defaultMinutes: 480, shape: "no_agent_reply" },
  resolved_without_csat_for: { defaultMinutes: 2880, shape: "resolved_no_csat" },
  past_resolution_due_by: { defaultMinutes: 0, shape: "past_due" },
  open_for: { defaultMinutes: 10080, shape: "open_age" },
  no_work_logged_for: { defaultMinutes: 4320, shape: "no_work_logged" },
};

// ── Actions ───────────────────────────────────────────────────────────

export type ActionDef = {
  mutating: boolean;
  /** Counts toward the hourly budget. A note or a flag is cheap; an SMS to a
   *  role is not. Used to weight the budget so a rule cannot send 200 texts
   *  while technically staying under a 200-"action" cap. */
  weight: number;
};

export const ACTION_DEFS: Record<ActionType, ActionDef> = {
  notify: { mutating: false, weight: 3 },
  internal_note: { mutating: false, weight: 1 },
  flag: { mutating: false, weight: 1 },
  webhook: { mutating: false, weight: 2 },
  assign: { mutating: true, weight: 2 },
  add_coassignee: { mutating: true, weight: 2 },
  set_priority: { mutating: true, weight: 1 },
  set_category: { mutating: true, weight: 1 },
  set_type: { mutating: true, weight: 1 },
  set_service_type: { mutating: true, weight: 1 },
  set_billable: { mutating: true, weight: 1 },
  escalate: { mutating: true, weight: 3 },
  pause_sla: { mutating: true, weight: 1 },
  resume_sla: { mutating: true, weight: 1 },
  add_participant: { mutating: true, weight: 3 },
  resolve: { mutating: true, weight: 3 },
  close: { mutating: true, weight: 3 },
};

/** Actions the engine will perform in Phase 1. */
export const SAFE_ACTION_TYPES = ACTION_TYPES.filter(
  (t) => !MUTATING_ACTIONS.has(t),
);

// ── Columns the database trigger records ──────────────────────────────
//
// The source of truth for the SQL side lives in
// src/lib/db/add-automation-rules.ts; this copy is what the TypeScript side
// reasons about, and catalog.test.ts asserts the two agree. Keeping the list
// narrow matters: every column here costs an outbox row on every write that
// touches it.

export const WATCHED_COLUMNS = [
  "status",
  "priority",
  "category",
  "type",
  "service_type",
  "assigned_to_id",
  "organization_id",
  "org_match_status",
  "billable",
  "invoice_number",
  "is_escalated",
  "csat_rating",
  "reopened_count",
  "first_response_at",
  "sla_warning_50_at",
  "sla_warning_80_at",
  "sla_breached_at",
] as const;

export type WatchedColumn = (typeof WATCHED_COLUMNS)[number];

// ── Browser-safe projection ───────────────────────────────────────────

export type ClientFieldDef = Omit<ConditionFieldDef, "read">;

export type ClientCatalog = {
  fields: Record<string, ClientFieldDef>;
  fieldOrder: readonly string[];
  events: Record<string, { category: EventTriggerDef["category"] }>;
  eventOrder: readonly string[];
  states: Record<string, StateTriggerDef>;
  stateOrder: readonly string[];
  actions: Record<string, ActionDef>;
  safeActions: readonly string[];
};

/** Strip the accessors so the catalog can be handed to a client component. */
export function clientCatalog(): ClientCatalog {
  const fields: Record<string, ClientFieldDef> = {};
  for (const id of CONDITION_FIELDS_IDS) {
    const def = CONDITION_FIELDS[id];
    // Everything except the accessor, which cannot cross to the browser.
    fields[id] = {
      group: def.group,
      valueType: def.valueType,
      operators: def.operators,
      ...(def.options ? { options: def.options } : {}),
      ...(def.reference ? { reference: def.reference } : {}),
      ...(def.unit ? { unit: def.unit } : {}),
      ...(def.multi ? { multi: def.multi } : {}),
    };
  }
  const events: Record<string, { category: EventTriggerDef["category"] }> = {};
  for (const id of EVENT_TRIGGERS) {
    events[id] = { category: EVENT_TRIGGER_DEFS[id].category };
  }
  return {
    fields,
    fieldOrder: CONDITION_FIELDS_IDS,
    events,
    eventOrder: EVENT_TRIGGERS,
    states: STATE_TRIGGER_DEFS,
    stateOrder: STATE_TRIGGERS,
    actions: ACTION_DEFS,
    safeActions: SAFE_ACTION_TYPES,
  };
}
