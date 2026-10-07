// ── The rule library ──────────────────────────────────────────────────
//
// A blank if/then builder is powerful and horrible. This is the front door
// instead: prewritten rules for the work this company actually does, so the
// common case is "click one, change two numbers, save" and nobody has to
// learn the catalog to get value on day one.
//
// Every template ships with `flag` ONLY — it records that it matched and
// tells nobody. That is deliberate and it is the single most useful habit
// this feature can encourage: switch it on, leave it a day, read the activity
// log, and only then add the notification. The alternative is discovering the
// conditions were wrong by texting fourteen people at 02:00.
//
// Pure data. No imports beyond the types, so the builder renders it in the
// browser without a round trip.

import type { ConditionGroup, RuleAction, RuleDedupe, RuleTrigger } from "./types";

export type RuleTemplate = {
  id: string;
  name: string;
  /** One line, in the operator's language, about when to reach for this. */
  blurb: string;
  category: "response" | "ownership" | "quality" | "billing" | "housekeeping";
  trigger: RuleTrigger;
  conditions: ConditionGroup;
  actions: RuleAction[];
  dedupe: RuleDedupe;
  /** What to change first. Shown as a hint beside the form. */
  tweak: string;
};

const all = (...conditions: ConditionGroup["conditions"]): ConditionGroup => ({
  combinator: "all",
  conditions,
});

const flag = (reason: string): RuleAction[] => [{ type: "flag", reason }];

export const RULE_TEMPLATES: RuleTemplate[] = [
  // ── Ownership ───────────────────────────────────────────────────────
  {
    id: "critical-unowned",
    name: "Chase a critical ticket nobody has picked up",
    blurb:
      "A Critical ticket with no owner after half an hour is the one that turns into a phone call from the client.",
    category: "ownership",
    trigger: { kind: "state", state: "unassigned_for", minutes: 30 },
    conditions: all({ field: "priority", operator: "is", value: "critical" }),
    actions: flag("{ticketNumber} is Critical and still has no owner."),
    dedupe: { policy: "once_per_occurrence" },
    tweak: "Change 30 minutes, then add who to tell.",
  },
  {
    id: "out-of-hours-arrival",
    name: "Spot a ticket that arrives out of hours",
    blurb:
      "Anything raised at night or at the weekend, so the on-call person sees it rather than Monday morning.",
    category: "ownership",
    trigger: { kind: "event", event: "ticket.created" },
    conditions: all(
      { field: "inside_business_hours", operator: "is", value: false },
      { field: "priority", operator: "is_one_of", value: ["high", "critical"] },
    ),
    actions: flag("{ticketNumber} arrived outside office hours — {priority}."),
    dedupe: { policy: "once_per_ticket" },
    tweak: "Decide which priorities count, then add the on-call technician.",
  },
  {
    id: "handover-watch",
    name: "Notice when a ticket changes hands",
    blurb:
      "Reassignments are where context gets lost. Useful to watch for a week when a new technician joins.",
    category: "ownership",
    trigger: { kind: "event", event: "ticket.reassigned" },
    conditions: all(),
    actions: flag("{ticketNumber} changed hands."),
    dedupe: { policy: "once_per_occurrence" },
    tweak: "Narrow it to one client or one priority if it is too noisy.",
  },

  // ── Response ────────────────────────────────────────────────────────
  {
    id: "first-reply-overdue",
    name: "Catch a ticket nobody has answered",
    blurb:
      "Not the SLA clock — this is the simpler question of whether a human has written back yet.",
    category: "response",
    trigger: { kind: "state", state: "no_first_response_for", minutes: 60 },
    conditions: all({
      field: "priority",
      operator: "is_one_of",
      value: ["high", "critical"],
    }),
    actions: flag("Nobody has replied to {ticketNumber} yet ({ageHours} old)."),
    dedupe: { policy: "once_per_occurrence" },
    tweak: "An hour is a starting point. Try two for Medium.",
  },
  {
    id: "customer-waiting-on-us",
    name: "Find a customer waiting on us",
    blurb:
      "They wrote, and nobody has answered. The single most common cause of a complaint.",
    category: "response",
    trigger: { kind: "state", state: "no_agent_reply_for", minutes: 480 },
    conditions: all(),
    actions: flag("{customerName} has been waiting on us for {minutesInStatus}."),
    dedupe: { policy: "throttle", throttleMinutes: 1440 },
    tweak: "Eight hours is one working day. Shorten it for Critical only.",
  },
  {
    id: "vip-client",
    name: "Watch one client closely",
    blurb:
      "Everything from a particular client, for a contract that needs a tighter eye on it.",
    category: "response",
    trigger: { kind: "event", event: "ticket.created" },
    conditions: all({ field: "organization", operator: "is_empty" }),
    actions: flag("New ticket from {organizationName}: {subject}"),
    dedupe: { policy: "once_per_ticket" },
    tweak: "Pick the client first — the condition is empty on purpose.",
  },

  // ── Quality ─────────────────────────────────────────────────────────
  {
    id: "unhappy-rating",
    name: "React when a customer rates us unhappy",
    blurb:
      "The one thing nobody should hear about late. Pairs well with telling the IT Director directly.",
    category: "quality",
    trigger: { kind: "event", event: "ticket.csat_received" },
    conditions: all({ field: "csat_rating", operator: "is", value: "unhappy" }),
    actions: flag("{customerName} was unhappy with {ticketNumber}."),
    dedupe: { policy: "once_per_occurrence" },
    tweak: "Add the IT Director and switch on email.",
  },
  {
    id: "repeat-reopen",
    name: "Flag a ticket that keeps coming back",
    blurb:
      "Three reopens means the fix is not the fix. Worth a second pair of eyes rather than a fourth attempt.",
    category: "quality",
    trigger: { kind: "event", event: "ticket.reopened" },
    conditions: all({ field: "reopened_count", operator: "gte", value: 3 }),
    actions: flag("{ticketNumber} has now been reopened {reopenedCount} times."),
    dedupe: { policy: "once_per_occurrence" },
    tweak: "Lower to 2 if you want to catch it earlier.",
  },
  {
    id: "escalation-landed",
    name: "Know when something is escalated",
    blurb: "So the person it was escalated TO finds out without being told twice.",
    category: "quality",
    trigger: { kind: "event", event: "ticket.escalated" },
    conditions: all(),
    actions: flag("{ticketNumber} was escalated."),
    dedupe: { policy: "once_per_occurrence" },
    tweak: 'Add "whoever it was escalated to" as the audience.',
  },
  {
    id: "stalled-work",
    name: "Find work that has quietly stalled",
    blurb:
      "In progress, but nobody has logged anything against it for three days.",
    category: "quality",
    trigger: { kind: "state", state: "no_work_logged_for", minutes: 4320 },
    conditions: all({ field: "status", operator: "is", value: "in_progress" }),
    actions: flag("No work logged on {ticketNumber} for three days."),
    dedupe: { policy: "throttle", throttleMinutes: 4320 },
    tweak: "Three days suits most teams. Try one for Critical.",
  },

  // ── Billing ─────────────────────────────────────────────────────────
  {
    id: "plan-running-out",
    name: "Warn before a client's monthly hours run out",
    blurb:
      "Catching this at an hour left is a conversation. Catching it below zero is an invoice argument.",
    category: "billing",
    trigger: { kind: "event", event: "ticket.created" },
    conditions: all({
      field: "org_monthly_balance_minutes",
      operator: "lte",
      value: 60,
    }),
    actions: flag("{organizationName} has under an hour of plan time left."),
    dedupe: { policy: "throttle", throttleMinutes: 1440 },
    tweak: "60 minutes is the warning line. Raise it for bigger contracts.",
  },
  {
    id: "resolved-unbilled",
    name: "Catch billable work with no invoice number",
    blurb:
      "Resolved, chargeable, and nobody has keyed the invoice in. This is money that quietly does not get billed.",
    category: "billing",
    trigger: { kind: "state", state: "resolved_without_csat_for", minutes: 2880 },
    conditions: all(
      {
        field: "billable",
        operator: "is_one_of",
        value: ["hourly_regular", "hourly_premium", "project"],
      },
      { field: "invoice_number", operator: "is_empty" },
    ),
    actions: flag("{ticketNumber} is billable and has no invoice number."),
    dedupe: { policy: "once_per_ticket" },
    tweak: "Point it at whoever does your invoicing.",
  },

  // ── Housekeeping ────────────────────────────────────────────────────
  {
    id: "untriaged-client",
    name: "Pick up a ticket we could not match to a client",
    blurb:
      "Someone claimed a company we could not confirm. It bills to nobody until a human looks.",
    category: "housekeeping",
    trigger: { kind: "event", event: "ticket.org_unverified" },
    conditions: all(),
    actions: flag("{ticketNumber} claims a client we could not confirm."),
    dedupe: { policy: "once_per_ticket" },
    tweak: "Send this to whoever does triage.",
  },
  {
    id: "morning-sweep",
    name: "Every morning, list what is still open and critical",
    blurb:
      "A standing 08:00 check so the day starts with the same picture for everyone.",
    category: "housekeeping",
    trigger: {
      kind: "schedule",
      hour: 8,
      minute: 0,
      weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    },
    conditions: all(
      { field: "priority", operator: "is", value: "critical" },
      { field: "status", operator: "is_not_one_of", value: ["resolved", "closed"] },
    ),
    actions: flag("Still open and Critical: {ticketNumber} — {subject}"),
    dedupe: { policy: "once_per_occurrence" },
    tweak: "This acts on each ticket separately, not as one summary.",
  },
  {
    id: "stuck-on-hold",
    name: "Revisit anything parked on hold too long",
    blurb: "On hold is where tickets go to be forgotten. This is the reminder.",
    category: "housekeeping",
    trigger: { kind: "state", state: "in_status_for", minutes: 10080 },
    conditions: all({
      field: "status",
      operator: "is_one_of",
      value: ["on_hold", "awaiting_customer_confirmation"],
    }),
    actions: flag("{ticketNumber} has been parked for a week."),
    dedupe: { policy: "throttle", throttleMinutes: 10080 },
    tweak: "A week is the default. Two is kinder on long projects.",
  },
];

export const TEMPLATE_CATEGORY_LABELS: Record<
  RuleTemplate["category"],
  string
> = {
  ownership: "Who owns it",
  response: "Answering people",
  quality: "Quality",
  billing: "Billing",
  housekeeping: "Tidying up",
};

export function templateById(id: string): RuleTemplate | undefined {
  return RULE_TEMPLATES.find((t) => t.id === id);
}
