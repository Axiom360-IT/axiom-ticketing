import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { tickets } from "./tickets";

// ── The rule engine's tables ──────────────────────────────────────────
//
// Four tables and one database trigger. See docs/automation-rules.md for the
// reasoning; the short version is that there are 65 places in this codebase
// that write to `tickets`, so the engine learns about change from a Postgres
// trigger writing an outbox row rather than from 65 hand-placed emits that
// would start rotting the day they were added.
//
// The trigger itself is NOT expressible in Drizzle. It lives in
// src/lib/db/add-automation-rules.ts and is asserted by a test, because a
// silently-missing trigger would present as "the engine works, but no event
// rule ever fires" — the worst possible failure mode.

export const automationRules = pgTable(
  "automation_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    enabled: boolean("enabled").notNull().default(true),
    /** Lower runs first; ties broken by `createdAt` so the order is total. */
    order: integer("order").notNull().default(100),
    /** One of event | state | schedule. Denormalized out of `trigger` so the
     *  three dispatchers can each select only their own rules instead of
     *  loading all of them and filtering in TypeScript. */
    triggerKind: text("trigger_kind").notNull(),
    /** Denormalized too: the event name or state id, so the event dispatcher
     *  can index straight to the rules a given change could possibly match. */
    triggerKey: text("trigger_key").notNull(),
    trigger: jsonb("trigger").notNull(),
    conditions: jsonb("conditions").notNull().default(sql`'{"combinator":"all","conditions":[]}'::jsonb`),
    actions: jsonb("actions").notNull().default(sql`'[]'::jsonb`),
    dedupe: jsonb("dedupe").notNull().default(sql`'{"policy":"once_per_ticket"}'::jsonb`),
    /** Stop later rules running for this ticket once this one matches. */
    stopOnMatch: boolean("stop_on_match").notNull().default(false),
    /** Let this rule fire on changes another rule caused. Half of the loop
     *  guard — see invariant I1. */
    allowChaining: boolean("allow_chaining").notNull().default(false),
    /** Let a state rule reach back over tickets that were already waiting
     *  when it was written. Off by default so saving a rule cannot alert on
     *  the entire backlog at once. */
    applyToExisting: boolean("apply_to_existing").notNull().default(false),
    /** Weighted actions this rule may run per rolling hour before it pauses
     *  itself. A mis-written rule costs one hour, not a day. */
    hourlyBudget: integer("hourly_budget").notNull().default(200),
    /** Non-null means the rule is skipped and the card says why. A rule is
     *  never allowed to fail silently (invariant I5). */
    brokenReason: text("broken_reason"),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
    /** Running total for the current budget window, with the window's start.
     *  Cheaper than counting rule_action_log rows on every evaluation. */
    budgetWindowStartedAt: timestamp("budget_window_started_at", {
      withTimezone: true,
    }),
    budgetSpent: integer("budget_spent").notNull().default(0),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "automation_rules_trigger_kind_check",
      sql`${t.triggerKind} IN ('event','state','schedule')`,
    ),
    check("automation_rules_order_check", sql`${t.order} BETWEEN 0 AND 9999`),
    check(
      "automation_rules_budget_check",
      sql`${t.hourlyBudget} BETWEEN 1 AND 10000`,
    ),
    // The event dispatcher's only read: enabled rules for one trigger key.
    index("automation_rules_kind_key_idx").on(
      t.triggerKind,
      t.triggerKey,
      t.enabled,
    ),
    index("automation_rules_order_idx").on(t.order, t.createdAt),
  ],
);

export const ticketChangeEvents = pgTable(
  "ticket_change_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    /** insert | update | message */
    op: text("op").notNull(),
    /** `{ column: { from, to } }`, watched columns only. */
    changed: jsonb("changed").notNull().default(sql`'{}'::jsonb`),
    /** Message facts, when op = 'message': author type, note flag, moderation
     *  status. Lets the drain classify a reply without a second query. */
    messageFacts: jsonb("message_facts"),
    /** Who caused it, when the writer was an authenticated request. NULL for
     *  cron jobs and inbound email. */
    actorId: uuid("actor_id"),
    /** Set when a RULE caused this change. The other half of the loop guard:
     *  a rule without `allowChaining` skips any event carrying this. */
    causedByRuleId: uuid("caused_by_rule_id"),
    /** How many rule hops led here. Capped at MAX_CHAIN_DEPTH. */
    chainDepth: integer("chain_depth").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Set when the drain has handled it. Kept briefly for debugging, then
     *  pruned by housekeeping. */
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "ticket_change_events_op_check",
      sql`${t.op} IN ('insert','update','message')`,
    ),
    // The drain's only read: unprocessed, oldest first.
    index("ticket_change_events_unprocessed_idx")
      .on(t.createdAt)
      .where(sql`${t.processedAt} IS NULL`),
    index("ticket_change_events_ticket_idx").on(t.ticketId, t.createdAt.desc()),
  ],
);

export const ruleFires = pgTable(
  "rule_fires",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => automationRules.id, { onDelete: "cascade" }),
    /** NULL for a schedule rule, which fires without a ticket in hand. */
    ticketId: uuid("ticket_id").references(() => tickets.id, {
      onDelete: "cascade",
    }),
    /** What makes this firing distinct. The dedupe policy decides its shape:
     *  'once' for once_per_ticket, the event+timestamp for per-occurrence, a
     *  floored time bucket for throttle, the local date for a schedule. */
    occurrenceKey: text("occurrence_key").notNull(),
    firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // THE idempotency guarantee. The engine inserts this row BEFORE running
    // the actions (invariant I3), so a unique violation is how a concurrent
    // or retried run discovers it has nothing to do.
    uniqueIndex("rule_fires_unique_idx").on(
      t.ruleId,
      t.ticketId,
      t.occurrenceKey,
    ),
    index("rule_fires_fired_at_idx").on(t.firedAt),
  ],
);

export const ruleActionLog = pgTable(
  "rule_action_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => automationRules.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").references(() => tickets.id, {
      onDelete: "set null",
    }),
    /** Ticket number, kept verbatim so the log still reads after a purge. */
    ticketNumber: text("ticket_number"),
    /** The event or state that set this off, for the "why" column. */
    triggerKey: text("trigger_key").notNull(),
    actionType: text("action_type").notNull(),
    /** ok | skipped | error */
    outcome: text("outcome").notNull(),
    /** One line: who was told, what changed, or why it was skipped. */
    detail: text("detail"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "rule_action_log_outcome_check",
      sql`${t.outcome} IN ('ok','skipped','error')`,
    ),
    index("rule_action_log_rule_idx").on(t.ruleId, t.createdAt.desc()),
    index("rule_action_log_ticket_idx").on(t.ticketId, t.createdAt.desc()),
  ],
);

/**
 * Rules that evaluated but did NOT match, with the condition that failed.
 *
 * This is the "why didn't my rule fire?" table, and it is deliberately
 * separate from `rule_action_log`: it is high-volume, low-value, and pruned
 * aggressively. Only written when a rule's trigger matched — a rule whose
 * trigger never fired has nothing to explain.
 */
export const ruleMissLog = pgTable(
  "rule_miss_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => automationRules.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").references(() => tickets.id, {
      onDelete: "cascade",
    }),
    ticketNumber: text("ticket_number"),
    triggerKey: text("trigger_key").notNull(),
    reason: text("reason").notNull(),
    /** Path to the failing condition, e.g. "root.1" — the builder highlights
     *  it so the operator sees which line to change. */
    failedAt: text("failed_at"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("rule_miss_log_rule_idx").on(t.ruleId, t.createdAt.desc())],
);
