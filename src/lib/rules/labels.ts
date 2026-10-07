// ── Human wording for the catalog ─────────────────────────────────────
//
// Plain strings in exhaustive `Record<Id, string>` maps rather than i18n keys,
// following the precedent set by `lib/automations/registry.ts` and
// `lib/audit/action-label.ts`: the app ships English-only from one messages
// file, and these maps are read from BOTH server components and client
// components with no translator in scope.
//
// The payoff of the exhaustive Record type is that TypeScript — not a test —
// refuses to compile a catalog entry with no wording. A missing label here
// would otherwise reach an operator as `org_monthly_balance_minutes` on the
// one screen whose whole job is reading like a sentence.
//
// Wording rules, so the generated sentence reads as English:
//   • event labels complete "When …"           → "a ticket is created"
//   • state labels complete "When a ticket has …" → "been unassigned for"
//   • field labels are noun phrases            → "the client's hours left"
//   • operator labels are verb phrases         → "is not one of"
//   • action labels complete "then …"          → "post an internal note"

import { WEEKDAYS } from "@/lib/automations/schedule";
import type { ConditionFieldId } from "./catalog";
import type {
  ActionType,
  ConditionOperator,
  DedupePolicy,
  EventTriggerId,
  NotifyAudience,
  NotifyChannel,
  StateTriggerId,
} from "./types";

export const EVENT_LABELS: Record<EventTriggerId, string> = {
  "ticket.created": "a ticket is raised",
  "ticket.status_changed": "a ticket's status changes",
  "ticket.assigned": "a ticket gets an owner",
  "ticket.unassigned": "a ticket loses its owner",
  "ticket.reassigned": "a ticket changes hands",
  "ticket.priority_changed": "a ticket's priority changes",
  "ticket.priority_raised": "a ticket's priority is raised",
  "ticket.category_changed": "a ticket's category changes",
  "ticket.type_changed": "a ticket's work type changes",
  "ticket.service_type_changed": "a ticket switches between onsite and remote",
  "ticket.escalated": "a ticket is escalated",
  "ticket.deescalated": "a ticket is taken off escalation",
  "ticket.resolved": "a ticket is resolved",
  "ticket.reopened": "a ticket is reopened",
  "ticket.closed": "a ticket is closed",
  "ticket.first_response": "someone answers a ticket for the first time",
  "ticket.csat_received": "a customer rates our work",
  "ticket.sla_warning_50": "a ticket passes half its SLA time",
  "ticket.sla_warning_80": "a ticket passes 80% of its SLA time",
  "ticket.sla_breached": "a ticket misses its SLA",
  "ticket.billable_set": "a ticket's billing type is set",
  "ticket.invoice_set": "an invoice number is added to a ticket",
  "ticket.org_matched": "a ticket is linked to a client",
  "ticket.org_unverified": "a ticket claims a client we could not confirm",
  "ticket.customer_replied": "a customer replies",
  "ticket.agent_replied": "a technician replies",
  "ticket.note_added": "an internal note is added",
  "ticket.reply_held": "a reply is held for review",
};

export const STATE_LABELS: Record<StateTriggerId, string> = {
  unassigned_for: "had no owner for",
  in_status_for: "sat in the same status for",
  no_first_response_for: "gone unanswered for",
  no_customer_reply_for: "waited on the customer for",
  no_agent_reply_for: "waited on us for",
  resolved_without_csat_for: "been resolved with no rating for",
  past_resolution_due_by: "been past its due time by",
  open_for: "been open for",
  no_work_logged_for: "had no work logged for",
};

export const FIELD_LABELS: Record<ConditionFieldId, string> = {
  // ticket
  priority: "priority",
  status: "status",
  category: "category",
  type: "work type",
  service_type: "onsite or remote",
  stream: "internal or external",
  origin: "where it came from",
  created_via: "how it was raised",
  subject: "the subject",
  description: "the description",
  billable: "billing type",
  invoice_number: "invoice number",
  reopened_count: "times reopened",
  csat_rating: "the customer's rating",
  // people
  assignee: "the owner",
  assignee_role: "the owner's role",
  customer_email: "the customer's email",
  customer_domain: "the customer's email domain",
  participant_count: "number of people on the ticket",
  // organization
  organization: "the client",
  org_match_status: "how the client was identified",
  org_is_internal: "the client is our own company",
  org_monthly_balance_minutes: "the client's plan balance",
  // sla
  sla_state: "SLA state",
  is_escalated: "it is escalated",
  escalation_reason: "escalation reason",
  escalation_target_role: "escalated to",
  first_response_received: "someone has answered it",
  minutes_past_resolution_due: "time past its due date",
  // timing
  age_minutes: "the ticket's age",
  minutes_in_status: "time in its current status",
  minutes_since_customer_message: "time since the customer wrote",
  minutes_since_agent_message: "time since we wrote",
  minutes_since_assigned: "time since it was assigned",
  inside_business_hours: "it is inside office hours",
  is_holiday: "today is a holiday",
  weekday: "the day of the week",
  hour_of_day: "the hour of the day",
  // work
  work_log_minutes: "work logged",
  attachment_count: "number of attachments",
  public_message_count: "number of replies",
};

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  is: "is",
  is_not: "is not",
  is_one_of: "is any of",
  is_not_one_of: "is none of",
  is_empty: "is empty",
  is_not_empty: "is set",
  contains: "contains",
  not_contains: "does not contain",
  gt: "is more than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
};

export const ACTION_LABELS: Record<ActionType, string> = {
  notify: "tell someone",
  internal_note: "post an internal note",
  flag: "just record it, without telling anyone",
  webhook: "call a webhook",
  assign: "assign it",
  add_coassignee: "add a second technician",
  set_priority: "change the priority",
  set_category: "change the category",
  set_type: "change the work type",
  set_service_type: "change onsite or remote",
  set_billable: "set the billing type",
  escalate: "escalate it",
  pause_sla: "pause the SLA clock",
  resume_sla: "restart the SLA clock",
  add_participant: "add someone to the ticket",
  resolve: "mark it resolved",
  close: "close it",
};

export const CHANNEL_LABELS: Record<NotifyChannel, string> = {
  in_app: "in the app",
  email: "by email",
  sms: "by text",
};

export const AUDIENCE_LABELS: Record<NotifyAudience, string> = {
  assignee: "whoever owns it",
  customer: "the customer",
  org_trusted_contacts: "the client's contacts",
  participants: "everyone on the ticket",
  escalation_target_role: "whoever it was escalated to",
  named_users: "chosen people",
  named_roles: "everyone in a role",
  named_emails: "chosen addresses",
};

export const DEDUPE_LABELS: Record<DedupePolicy, string> = {
  always: "every time",
  once_per_ticket: "once per ticket, ever",
  once_per_occurrence: "once each time it happens",
  throttle: "at most once in a while",
};

// ── Enum value wording ────────────────────────────────────────────────
//
// Not an exhaustive Record: the keys come from several independent
// vocabularies that share no type, and category/type values are
// admin-managed at run time. A value with no entry falls back to a
// title-cased version of itself, which is honest rather than wrong —
// `VALUE_LABELS` only exists to improve on that where title-casing reads
// badly ("Hourly regular" → "Hourly — standard rate").

const VALUE_LABELS: Record<string, string> = {
  // priority / status
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
  draft: "Draft",
  open: "Open",
  in_progress: "In progress",
  awaiting_customer_confirmation: "Awaiting the customer",
  on_hold: "On hold",
  escalation: "Escalated",
  resolved: "Resolved",
  closed: "Closed",
  // service type / stream / origin
  onsite: "Onsite",
  remote: "Remote",
  hybrid: "Hybrid",
  internal: "Internal",
  external: "External",
  web_form: "The public form",
  email: "Email",
  portal: "The customer portal",
  direct_email: "An email to us",
  forwarded_email: "An email a colleague forwarded",
  manual: "Raised by staff",
  // org match
  account: "From their account",
  domain: "From their email domain",
  staff: "Confirmed by staff",
  unverified: "Claimed but unconfirmed",
  none: "No client information",
  // billable
  hourly_regular: "Hourly — standard rate",
  hourly_premium: "Hourly — premium rate",
  no: "Not billable",
  monthly_plan: "Monthly plan",
  project: "Project",
  rework: "Rework",
  // csat
  happy: "Happy",
  neutral: "Neutral",
  unhappy: "Unhappy",
  // escalation reasons
  beyond_scope: "Beyond our scope",
  requires_access: "Needs access we do not have",
  critical_impact: "Critical impact",
  vendor_involvement: "Needs a vendor",
  other: "Other",
  // sla states
  ok: "On track",
  warning_50: "Half the time gone",
  warning_80: "80% of the time gone",
  breached: "Missed",
  paused: "Clock paused",
};

function titleCase(v: string): string {
  const spaced = v.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function valueLabel(v: string): string {
  return VALUE_LABELS[v] ?? titleCase(v);
}

/** Weekday names, for the schedule sentence. */
export const WEEKDAY_LABELS: Record<string, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

/** True when the given weekday list is exactly Mon–Fri, so the sentence can
 *  say "every weekday" instead of naming five days. */
export function isWeekdaysOnly(days: readonly string[]): boolean {
  if (days.length !== 5) return false;
  const set = new Set(days);
  return ["Mon", "Tue", "Wed", "Thu", "Fri"].every((d) => set.has(d));
}

export function isEveryDay(days: readonly string[]): boolean {
  return days.length === WEEKDAYS.length;
}
