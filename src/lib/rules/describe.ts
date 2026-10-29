// ── A rule, in one English sentence ───────────────────────────────────
//
// Nothing a human sees on the Automations page is ever raw jsonb. This is the
// same treatment that turned `*/5 * * * *` into "every five minutes" on the
// scheduled jobs: the stored shape is for the engine, the sentence is for the
// operator, and the sentence is generated so the two cannot drift.
//
// Pure. Reference ids (a user, a client) are resolved through a `RefNames`
// map the caller supplies, rather than by querying — that keeps this testable
// and lets the same function render on the server and in the browser as the
// builder is being typed into.

import {
  CONDITION_FIELDS,
  type ConditionFieldId,
  isConditionFieldId,
} from "./catalog";
import {
  ACTION_LABELS,
  AUDIENCE_LABELS,
  CHANNEL_LABELS,
  EVENT_LABELS,
  FIELD_LABELS,
  isEveryDay,
  isWeekdaysOnly,
  OPERATOR_LABELS,
  STATE_LABELS,
  valueLabel,
  WEEKDAY_LABELS,
} from "./labels";
import {
  type AutomationRule,
  type Condition,
  type ConditionGroup,
  type ConditionNode,
  type ConditionValue,
  isGroup,
  type RuleAction,
  type RuleTrigger,
  UNARY_OPERATORS,
} from "./types";

export type RefNames = {
  users?: Record<string, string>;
  roles?: Record<string, string>;
  organizations?: Record<string, string>;
};

/**
 * Minutes as the largest unit that stays exact.
 *
 * Exactness matters more than brevity here: rounding 90 minutes to "2 hours"
 * on a card whose threshold is 90 would have an operator reading a number the
 * engine is not using.
 */
export function describeDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "an unknown time";
  if (minutes === 0) return "no time at all";
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (minutes % 1440 === 0) return plural(minutes / 1440, "day");
  if (minutes % 60 === 0) return plural(minutes / 60, "hour");
  if (minutes > 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${plural(h, "hour")} ${plural(m, "minute")}`;
  }
  return plural(minutes, "minute");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function describeDays(days: readonly string[]): string {
  if (days.length === 0) return "never";
  if (isEveryDay(days)) return "every day";
  if (isWeekdaysOnly(days)) return "every weekday";
  return days.map((d) => WEEKDAY_LABELS[d] ?? d).join(", ");
}

export function describeTrigger(trigger: RuleTrigger): string {
  switch (trigger.kind) {
    case "event":
      return `When ${EVENT_LABELS[trigger.event]}`;
    case "state":
      return `When a ticket has ${STATE_LABELS[trigger.state]} ${describeDuration(trigger.minutes)}`;
    case "schedule":
      return `${describeDays(trigger.weekdays)} at ${pad(trigger.hour)}:${pad(trigger.minute)}`;
  }
}

function describeConditionValue(
  value: ConditionValue | undefined,
  field: ConditionFieldId,
  refs: RefNames,
): string {
  const def = CONDITION_FIELDS[field];

  const one = (v: string): string => {
    if (def.valueType === "reference") {
      const table =
        def.reference === "user"
          ? refs.users
          : def.reference === "organization"
            ? refs.organizations
            : def.reference === "role"
              ? refs.roles
              : undefined;
      // An id with no name is a reference to something that has been deleted
      // or renamed. Say so rather than printing a uuid at someone.
      if (table) return table[v] ?? "something that no longer exists";
      return v;
    }
    if (def.valueType === "enum") return valueLabel(v);
    return v;
  };

  if (Array.isArray(value)) {
    const parts = value.map((v) => one(String(v)));
    if (parts.length === 0) return "nothing";
    if (parts.length === 1) return parts[0] ?? "nothing";
    return `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}`;
  }
  if (value === true) return "yes";
  if (value === false) return "no";
  if (value === null || value === undefined) return "nothing";
  if (def.unit && typeof value === "number") return describeDuration(value);
  return one(String(value));
}

export function describeCondition(cond: Condition, refs: RefNames = {}): string {
  if (!isConditionFieldId(cond.field)) {
    return `an unknown setting ("${cond.field}")`;
  }
  const field = cond.field as ConditionFieldId;
  const label = FIELD_LABELS[field];
  const op = OPERATOR_LABELS[cond.operator] ?? cond.operator;

  // Boolean fields are already phrased as statements ("it is escalated"), so
  // "it is escalated is yes" would be nonsense.
  if (CONDITION_FIELDS[field].valueType === "boolean") {
    const wanted = cond.value === true || cond.value === "true";
    return wanted ? label : `not ${label}`;
  }

  if (UNARY_OPERATORS.has(cond.operator)) return `${label} ${op}`;

  return `${label} ${op} ${describeConditionValue(cond.value, field, refs)}`;
}

function describeNode(node: ConditionNode, refs: RefNames, depth: number): string {
  if (!isGroup(node)) return describeCondition(node, refs);
  if (node.conditions.length === 0) return "";
  const joiner = node.combinator === "all" ? " and " : " or ";
  const parts = node.conditions
    .map((c) => describeNode(c, refs, depth + 1))
    .filter((s) => s !== "");
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0] ?? "";
  const joined = parts.join(joiner);
  return depth > 0 ? `(${joined})` : joined;
}

export function describeConditions(
  conditions: ConditionGroup,
  refs: RefNames = {},
): string {
  return describeNode(conditions, refs, 0);
}

function listNames(
  ids: string[] | undefined,
  table: Record<string, string> | undefined,
  fallback: string,
): string {
  if (!ids || ids.length === 0) return fallback;
  const names = ids.map((id) => table?.[id] ?? id);
  if (names.length === 1) return names[0] ?? fallback;
  if (names.length === 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function describeAction(action: RuleAction, refs: RefNames = {}): string {
  switch (action.type) {
    case "notify": {
      const channels = action.channels.map((c) => CHANNEL_LABELS[c]).join(" and ");
      const who = action.audiences
        .map((a) => {
          if (a === "named_users") {
            return listNames(action.userIds, refs.users, "nobody chosen");
          }
          if (a === "named_roles") {
            return `everyone who is ${listNames(action.roles, refs.roles, "nobody chosen")}`;
          }
          if (a === "named_emails") {
            return listNames(action.emails, undefined, "nobody chosen");
          }
          return AUDIENCE_LABELS[a];
        })
        .join(" and ");
      return `tell ${who || "nobody"} ${channels || "— no channel chosen"}`;
    }
    case "internal_note":
      return "post an internal note";
    case "flag":
      // Not the note's own text: it is mail-merge syntax ("{ticketNumber}
      // matched this rule.") and reads as code inside a sentence.
      return "record it without telling anyone";
    case "webhook":
      return "call a webhook";
    case "assign":
      return action.mode === "user"
        ? `assign it to ${refs.users?.[action.userId ?? ""] ?? "a chosen technician"}`
        : `assign it to whoever is least busy in ${refs.roles?.[action.role ?? ""] ?? action.role ?? "a role"}`;
    case "add_coassignee":
      return `add ${refs.users?.[action.userId] ?? "a second technician"}`;
    case "set_priority":
      return `set the priority to ${valueLabel(action.value)}`;
    case "set_category":
      return `set the category to ${valueLabel(action.value)}`;
    case "set_type":
      return `set the work type to ${valueLabel(action.value)}`;
    case "set_service_type":
      return `set it to ${valueLabel(action.value)}`;
    case "set_billable":
      return `set the billing type to ${valueLabel(action.value)}`;
    case "escalate":
      return `escalate it to ${action.targetRole} (${valueLabel(action.reason)})`;
    case "pause_sla":
      return "pause the SLA clock";
    case "resume_sla":
      return "restart the SLA clock";
    case "add_participant":
      return `add ${action.email} to the ticket`;
    case "resolve":
      return "mark it resolved";
    case "close":
      return "close it";
    default:
      // Exhaustive above; this catches a row written by a newer version.
      return ACTION_LABELS[(action as RuleAction).type] ?? "do something";
  }
}

export function describeActions(actions: RuleAction[], refs: RefNames = {}): string {
  if (actions.length === 0) return "do nothing";
  const parts = actions.map((a) => describeAction(a, refs));
  if (parts.length === 1) return parts[0] ?? "do nothing";
  return `${parts.slice(0, -1).join(", ")}, then ${parts[parts.length - 1]}`;
}

/** The whole rule as one sentence, for the card and the preview. */
export function describeRule(
  rule: Pick<AutomationRule, "trigger" | "conditions" | "actions">,
  refs: RefNames = {},
): string {
  const when = describeTrigger(rule.trigger);
  const ifs = describeConditions(rule.conditions, refs);
  const then = describeActions(rule.actions, refs);
  return ifs ? `${when}, and ${ifs}, ${then}.` : `${when}, ${then}.`;
}

/** The three parts separately, for the sentence-shaped editor where each
 *  clause is its own control. */
export function describeRuleParts(
  rule: Pick<AutomationRule, "trigger" | "conditions" | "actions">,
  refs: RefNames = {},
): { when: string; conditions: string; then: string } {
  return {
    when: describeTrigger(rule.trigger),
    conditions: describeConditions(rule.conditions, refs),
    then: describeActions(rule.actions, refs),
  };
}
