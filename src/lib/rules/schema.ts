// ── Validation ────────────────────────────────────────────────────────
//
// Zod is the shape check; the catalog is the semantic check. Both run on
// write AND on read.
//
// Re-validating on read is the unusual part and it is deliberate. A rule row
// is jsonb written by a previous version of this code: a field can be renamed
// or an operator withdrawn between the save and the next run. Parsing on read
// turns that into a rule marked `broken` with a reason, which is invariant I5
// — rather than a crash in the engine loop, which would take every other
// rule down with it.

import { z } from "zod";
import { isWeekday, WEEKDAYS } from "@/lib/automations/schedule";
import {
  ACTION_DEFS,
  CONDITION_FIELDS,
  type ConditionFieldId,
  isConditionFieldId,
} from "./catalog";
import {
  ACTION_TYPES,
  type ConditionGroup,
  CONDITION_OPERATORS,
  DEDUPE_POLICIES,
  EVENT_TRIGGERS,
  LIST_OPERATORS,
  MAX_ACTIONS_PER_RULE,
  MAX_CONDITIONS_PER_RULE,
  MUTATING_ACTIONS,
  NOTIFY_AUDIENCES,
  NOTIFY_CHANNELS,
  type RuleAction,
  type RuleTrigger,
  STATE_TRIGGERS,
  UNARY_OPERATORS,
} from "./types";

// ── Trigger ───────────────────────────────────────────────────────────

const weekdaySchema = z.string().refine(isWeekday, "not a weekday");

export const triggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("event"), event: z.enum(EVENT_TRIGGERS) }),
  z.object({
    kind: z.literal("state"),
    state: z.enum(STATE_TRIGGERS),
    // Upper bound is a year: a "has been open for" rule beyond that is a
    // typo, not a policy.
    minutes: z.number().int().min(0).max(525_600),
  }),
  z.object({
    kind: z.literal("schedule"),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
    weekdays: z.array(weekdaySchema).min(1).max(WEEKDAYS.length),
  }),
]);

// ── Conditions ────────────────────────────────────────────────────────

const conditionValueSchema = z.union([
  z.string().max(500),
  z.number(),
  z.boolean(),
  z.array(z.string().max(200)).max(50),
  z.null(),
]);

const conditionSchema = z
  .object({
    field: z.string().min(1).max(80),
    operator: z.enum(CONDITION_OPERATORS),
    value: conditionValueSchema.optional(),
  })
  .superRefine((c, ctx) => {
    if (!isConditionFieldId(c.field)) {
      ctx.addIssue({
        code: "custom",
        message: `There is no setting called "${c.field}".`,
      });
      return;
    }
    const def = CONDITION_FIELDS[c.field as ConditionFieldId];
    if (!def.operators.includes(c.operator)) {
      ctx.addIssue({
        code: "custom",
        message: `"${c.operator}" cannot be used on "${c.field}".`,
      });
      return;
    }
    if (UNARY_OPERATORS.has(c.operator)) return;

    if (LIST_OPERATORS.has(c.operator)) {
      if (!Array.isArray(c.value) || c.value.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: `"${c.field}" needs at least one value to compare against.`,
        });
      }
      return;
    }
    if (c.value === undefined || c.value === null || c.value === "") {
      ctx.addIssue({ code: "custom", message: `"${c.field}" needs a value.` });
      return;
    }
    if (def.valueType === "number" && typeof c.value !== "number") {
      ctx.addIssue({ code: "custom", message: `"${c.field}" needs a number.` });
    }
    // An enum value outside the vocabulary would be saveable and permanently
    // unmatchable — the exact silent failure the catalog exists to prevent.
    if (def.valueType === "enum" && def.options) {
      const vals = Array.isArray(c.value) ? c.value : [c.value];
      for (const v of vals) {
        if (!def.options.includes(String(v))) {
          ctx.addIssue({
            code: "custom",
            message: `"${String(v)}" is not a valid ${c.field}.`,
          });
        }
      }
    }
  });

type ConditionGroupInput = {
  combinator: "all" | "any";
  conditions: unknown[];
};

// Two levels only. Deeper nesting buys expressiveness nobody uses and costs
// comprehensibility everybody pays for — and `describe.ts` stops producing a
// readable sentence past one level of brackets.
const innerGroupSchema: z.ZodType<ConditionGroup> = z.object({
  combinator: z.enum(["all", "any"]),
  conditions: z.array(conditionSchema).max(MAX_CONDITIONS_PER_RULE),
}) as unknown as z.ZodType<ConditionGroup>;

export const conditionGroupSchema: z.ZodType<ConditionGroup> = z
  .object({
    combinator: z.enum(["all", "any"]),
    conditions: z
      .array(z.union([conditionSchema, innerGroupSchema]))
      .max(MAX_CONDITIONS_PER_RULE),
  })
  .superRefine((g, ctx) => {
    const total = (g as ConditionGroupInput).conditions.reduce<number>(
      (n, c) =>
        n + (c && typeof c === "object" && "combinator" in c
          ? ((c as ConditionGroup).conditions.length || 1)
          : 1),
      0,
    );
    if (total > MAX_CONDITIONS_PER_RULE) {
      ctx.addIssue({
        code: "custom",
        message: `A rule can have at most ${MAX_CONDITIONS_PER_RULE} conditions.`,
      });
    }
  }) as unknown as z.ZodType<ConditionGroup>;

// ── Actions ───────────────────────────────────────────────────────────

const emailSchema = z.string().trim().toLowerCase().email().max(200);
const uuidSchema = z.string().uuid();

const notifySchema = z
  .object({
    type: z.literal("notify"),
    channels: z.array(z.enum(NOTIFY_CHANNELS)).min(1).max(3),
    audiences: z.array(z.enum(NOTIFY_AUDIENCES)).min(1).max(8),
    userIds: z.array(uuidSchema).max(50).optional(),
    roles: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    emails: z.array(emailSchema).max(50).optional(),
    subject: z.string().trim().max(200).optional(),
    body: z.string().trim().min(1).max(4000),
  })
  .superRefine((a, ctx) => {
    // An audience with nothing behind it sends to nobody and tells no one why.
    const need = [
      ["named_users", a.userIds],
      ["named_roles", a.roles],
      ["named_emails", a.emails],
    ] as const;
    for (const [audience, list] of need) {
      if (a.audiences.includes(audience) && (!list || list.length === 0)) {
        ctx.addIssue({
          code: "custom",
          message: `You picked "${audience.replace("named_", "")}" but chose none.`,
        });
      }
    }
  });

export const actionSchema: z.ZodType<RuleAction> = z.union([
  notifySchema,
  z.object({
    type: z.literal("internal_note"),
    body: z.string().trim().min(1).max(4000),
  }),
  z.object({
    type: z.literal("flag"),
    reason: z.string().trim().min(1).max(200),
  }),
  z.object({
    type: z.literal("webhook"),
    // https only: a rule payload carries ticket content off this system.
    url: z.string().url().startsWith("https://").max(500),
    secret: z.string().max(200).optional(),
  }),
  z.object({
    type: z.literal("assign"),
    mode: z.enum(["user", "least_loaded_in_role"]),
    userId: uuidSchema.optional(),
    role: z.string().trim().min(1).max(80).optional(),
  }),
  z.object({ type: z.literal("add_coassignee"), userId: uuidSchema }),
  z.object({ type: z.literal("set_priority"), value: z.string().min(1).max(40) }),
  z.object({ type: z.literal("set_category"), value: z.string().min(1).max(80) }),
  z.object({ type: z.literal("set_type"), value: z.string().min(1).max(80) }),
  z.object({
    type: z.literal("set_service_type"),
    value: z.string().min(1).max(40),
  }),
  z.object({ type: z.literal("set_billable"), value: z.string().min(1).max(40) }),
  z.object({
    type: z.literal("escalate"),
    reason: z.string().min(1).max(40),
    targetRole: z.string().trim().min(1).max(80),
    note: z.string().trim().max(1000).optional(),
  }),
  z.object({ type: z.literal("pause_sla") }),
  z.object({ type: z.literal("resume_sla") }),
  z.object({ type: z.literal("add_participant"), email: emailSchema }),
  z.object({ type: z.literal("resolve"), note: z.string().trim().max(2000).optional() }),
  z.object({ type: z.literal("close") }),
]) as unknown as z.ZodType<RuleAction>;

// ── Dedupe ────────────────────────────────────────────────────────────

export const dedupeSchema = z
  .object({
    policy: z.enum(DEDUPE_POLICIES),
    throttleMinutes: z.number().int().min(1).max(525_600).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.policy === "throttle" && !d.throttleMinutes) {
      ctx.addIssue({
        code: "custom",
        message: "Choose how often this rule may repeat.",
      });
    }
  });

// ── The whole rule, as the form submits it ────────────────────────────

export const ruleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).nullable().optional(),
    trigger: triggerSchema,
    conditions: conditionGroupSchema,
    actions: z.array(actionSchema).min(1).max(MAX_ACTIONS_PER_RULE),
    dedupe: dedupeSchema,
    stopOnMatch: z.boolean().default(false),
    allowChaining: z.boolean().default(false),
    applyToExisting: z.boolean().default(false),
    order: z.number().int().min(0).max(9999).default(100),
  })
  .superRefine((r, ctx) => {
    // Every dedupe policy is meaningful on a schedule rule: it wakes on a
    // clock and then evaluates each open ticket, so it has a ticket in hand
    // exactly like the other two kinds. (An earlier design made scheduled
    // rules ticket-less digests, which is what scheduled REPORTS already do;
    // nothing here should re-import that assumption.)
    //
    // A state rule with `always` re-fires on every scan pass, which for a
    // 10-minute scanner means six alerts an hour, forever.
    if (r.trigger.kind === "state" && r.dedupe.policy === "always") {
      ctx.addIssue({
        code: "custom",
        message:
          "A rule that watches for a waiting ticket must not repeat every time it checks — choose once per ticket, or a repeat interval.",
      });
    }
  });

export type RuleInput = z.input<typeof ruleInputSchema>;
export type RuleParsed = z.output<typeof ruleInputSchema>;

// ── Reading a stored row back ─────────────────────────────────────────

export type StoredRuleParts = {
  trigger: RuleTrigger;
  conditions: ConditionGroup;
  actions: RuleAction[];
};

export type ParseStoredResult =
  | { ok: true; parts: StoredRuleParts }
  | { ok: false; reason: string };

/**
 * Parse the three jsonb columns of a stored rule.
 *
 * Returns a REASON rather than throwing, because the caller is a loop over
 * every rule: one unparseable row must not stop the other forty from running.
 */
export function parseStoredRule(row: {
  trigger: unknown;
  conditions: unknown;
  actions: unknown;
}): ParseStoredResult {
  const trigger = triggerSchema.safeParse(row.trigger);
  if (!trigger.success) {
    return { ok: false, reason: firstMessage(trigger.error, "Its trigger is no longer valid.") };
  }
  const conditions = conditionGroupSchema.safeParse(row.conditions);
  if (!conditions.success) {
    return {
      ok: false,
      reason: firstMessage(conditions.error, "One of its conditions is no longer valid."),
    };
  }
  const actions = z.array(actionSchema).min(1).safeParse(row.actions);
  if (!actions.success) {
    return {
      ok: false,
      reason: firstMessage(actions.error, "One of its actions is no longer valid."),
    };
  }
  return {
    ok: true,
    parts: {
      trigger: trigger.data as RuleTrigger,
      conditions: conditions.data,
      actions: actions.data as RuleAction[],
    },
  };
}

function firstMessage(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}

/** Does this rule try to change a ticket? The engine refuses these while it
 *  is in safe mode (see docs/automation-rules.md §8). */
export function hasMutatingAction(actions: RuleAction[]): boolean {
  return actions.some((a) => MUTATING_ACTIONS.has(a.type));
}

/** Weighted cost of one firing, for the hourly budget (invariant I2). A note
 *  is cheap; a text message to a whole role is not. */
export function actionCost(actions: RuleAction[]): number {
  return actions.reduce((n, a) => n + (ACTION_DEFS[a.type]?.weight ?? 1), 0);
}

export const ACTION_TYPE_VALUES = ACTION_TYPES;
