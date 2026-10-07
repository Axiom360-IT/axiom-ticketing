import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * The automation rule engine: four tables and the change-capture trigger.
 *
 * Idempotent — safe to re-run. One statement per `db.execute`, because the
 * neon-http driver rejects multi-statement strings. DEFAULT values are
 * literals in the SQL text, never `${}` interpolation: interpolation becomes
 * a bind parameter and Postgres will not accept a parameter in a DEFAULT.
 *
 * Run via `pnpm db:add-automation-rules`.
 *
 * ── Why a database trigger ──
 *
 * 65 places in this codebase write to `tickets` (58 updates, 7 inserts),
 * spread across server actions, the MCP write tools, the Inngest functions and
 * backfill scripts. Hand-placing an emit at each one needs 65 correct edits
 * today and perfect discipline forever. A trigger is complete by construction
 * and commits inside the writer's transaction, so an event can never be
 * recorded for a change that rolled back, nor lost for one that committed.
 * `0021_audit_log_hardening.sql` already took the same route for the same
 * reason. See docs/automation-rules.md §2.
 */

// Keep in step with WATCHED_COLUMNS in src/lib/rules/catalog.ts — a test reads
// both and fails if they diverge. Narrow on purpose: every column here costs
// an outbox row on every write that touches it.
const WATCHED_COLUMNS = [
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
];

async function main(): Promise<void> {
  // ── automation_rules ───────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "automation_rules" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" text NOT NULL,
      "description" text,
      "enabled" boolean NOT NULL DEFAULT true,
      "order" integer NOT NULL DEFAULT 100,
      "trigger_kind" text NOT NULL,
      "trigger_key" text NOT NULL,
      "trigger" jsonb NOT NULL,
      "conditions" jsonb NOT NULL DEFAULT '{"combinator":"all","conditions":[]}'::jsonb,
      "actions" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "dedupe" jsonb NOT NULL DEFAULT '{"policy":"once_per_ticket"}'::jsonb,
      "stop_on_match" boolean NOT NULL DEFAULT false,
      "allow_chaining" boolean NOT NULL DEFAULT false,
      "apply_to_existing" boolean NOT NULL DEFAULT false,
      "hourly_budget" integer NOT NULL DEFAULT 200,
      "broken_reason" text,
      "last_fired_at" timestamptz,
      "budget_window_started_at" timestamptz,
      "budget_spent" integer NOT NULL DEFAULT 0,
      "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const [name, expr] of [
    [
      "automation_rules_trigger_kind_check",
      sql`"trigger_kind" IN ('event','state','schedule')`,
    ],
    ["automation_rules_order_check", sql`"order" BETWEEN 0 AND 9999`],
    ["automation_rules_budget_check", sql`"hourly_budget" BETWEEN 1 AND 10000`],
  ] as const) {
    await db.execute(
      sql`ALTER TABLE "automation_rules" DROP CONSTRAINT IF EXISTS ${sql.identifier(name)}`,
    );
    await db.execute(
      sql`ALTER TABLE "automation_rules" ADD CONSTRAINT ${sql.identifier(name)} CHECK (${expr})`,
    );
  }

  // Added after the first release of this table; harmless on a fresh install.
  await db.execute(sql`
    ALTER TABLE "automation_rules"
      ADD COLUMN IF NOT EXISTS "apply_to_existing" boolean NOT NULL DEFAULT false
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "automation_rules_kind_key_idx"
      ON "automation_rules" ("trigger_kind", "trigger_key", "enabled")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "automation_rules_order_idx"
      ON "automation_rules" ("order", "created_at")
  `);

  // ── ticket_change_events (the outbox) ──────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "ticket_change_events" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "ticket_id" uuid NOT NULL REFERENCES "tickets"("id") ON DELETE CASCADE,
      "op" text NOT NULL,
      "changed" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "message_facts" jsonb,
      "actor_id" uuid,
      "caused_by_rule_id" uuid,
      "chain_depth" integer NOT NULL DEFAULT 0,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "processed_at" timestamptz
    )
  `);

  await db.execute(
    sql`ALTER TABLE "ticket_change_events" DROP CONSTRAINT IF EXISTS "ticket_change_events_op_check"`,
  );
  await db.execute(sql`
    ALTER TABLE "ticket_change_events" ADD CONSTRAINT "ticket_change_events_op_check"
      CHECK ("op" IN ('insert','update','message'))
  `);

  // The drain's only read: unprocessed, oldest first. A partial index keeps it
  // tiny no matter how much history is waiting to be pruned.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ticket_change_events_unprocessed_idx"
      ON "ticket_change_events" ("created_at") WHERE "processed_at" IS NULL
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ticket_change_events_ticket_idx"
      ON "ticket_change_events" ("ticket_id", "created_at" DESC)
  `);

  // ── rule_fires (idempotency ledger) ────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "rule_fires" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "rule_id" uuid NOT NULL REFERENCES "automation_rules"("id") ON DELETE CASCADE,
      "ticket_id" uuid REFERENCES "tickets"("id") ON DELETE CASCADE,
      "occurrence_key" text NOT NULL,
      "fired_at" timestamptz NOT NULL DEFAULT now()
    )
  `);

  // THE idempotency guarantee. The engine inserts here BEFORE running actions,
  // so a unique violation is how a retry discovers it has nothing to do.
  //
  // NULLS NOT DISTINCT matters: a schedule rule has no ticket, so ticket_id is
  // NULL, and under default NULL semantics every insert would look unique and
  // the guard would never engage.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "rule_fires_unique_idx"
      ON "rule_fires" ("rule_id", "ticket_id", "occurrence_key") NULLS NOT DISTINCT
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "rule_fires_fired_at_idx" ON "rule_fires" ("fired_at")
  `);

  // ── rule_action_log ────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "rule_action_log" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "rule_id" uuid NOT NULL REFERENCES "automation_rules"("id") ON DELETE CASCADE,
      "ticket_id" uuid REFERENCES "tickets"("id") ON DELETE SET NULL,
      "ticket_number" text,
      "trigger_key" text NOT NULL,
      "action_type" text NOT NULL,
      "outcome" text NOT NULL,
      "detail" text,
      "error" text,
      "created_at" timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(
    sql`ALTER TABLE "rule_action_log" DROP CONSTRAINT IF EXISTS "rule_action_log_outcome_check"`,
  );
  await db.execute(sql`
    ALTER TABLE "rule_action_log" ADD CONSTRAINT "rule_action_log_outcome_check"
      CHECK ("outcome" IN ('ok','skipped','error'))
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "rule_action_log_rule_idx"
      ON "rule_action_log" ("rule_id", "created_at" DESC)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "rule_action_log_ticket_idx"
      ON "rule_action_log" ("ticket_id", "created_at" DESC)
  `);

  // ── rule_miss_log ──────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "rule_miss_log" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "rule_id" uuid NOT NULL REFERENCES "automation_rules"("id") ON DELETE CASCADE,
      "ticket_id" uuid REFERENCES "tickets"("id") ON DELETE CASCADE,
      "ticket_number" text,
      "trigger_key" text NOT NULL,
      "reason" text NOT NULL,
      "failed_at" text,
      "created_at" timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "rule_miss_log_rule_idx"
      ON "rule_miss_log" ("rule_id", "created_at" DESC)
  `);

  // ── The change-capture trigger ─────────────────────────────────────
  //
  // Records a diff. No business logic — every decision stays in TypeScript
  // where it is testable.
  //
  // The EXCEPTION block is the most important line in this file. Without it, a
  // problem writing the outbox (a missing table during a partial deploy, a
  // full disk) would abort the INSERT or UPDATE that fired it, and the
  // ticketing system would stop accepting tickets because its automation
  // bookkeeping was unhappy. Losing an automation event is a nuisance; losing
  // a customer's ticket is not. `lib/automations/runs.ts` made the same call
  // for the same reason.
  //
  // actor_id / caused_by_rule_id come from transaction-local settings, which
  // the engine sets via set_config() inside the transaction that performs a
  // mutating action. `current_setting(..., true)` returns NULL when unset, so
  // every ordinary write simply leaves them null.
  const watchedLiteral = WATCHED_COLUMNS.map((c) => `'${c}'`).join(",");

  await db.execute(
    sql.raw(`
    CREATE OR REPLACE FUNCTION ticket_change_capture() RETURNS trigger AS $fn$
    DECLARE
      watched text[] := ARRAY[${watchedLiteral}];
      col text;
      diff jsonb := '{}'::jsonb;
      o jsonb;
      n jsonb;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        INSERT INTO ticket_change_events (ticket_id, op, changed, actor_id, caused_by_rule_id, chain_depth)
        VALUES (
          NEW.id, 'insert', '{}'::jsonb,
          nullif(current_setting('axiom.actor_id', true), '')::uuid,
          nullif(current_setting('axiom.rule_id', true), '')::uuid,
          coalesce(nullif(current_setting('axiom.chain_depth', true), '')::int, 0)
        );
        RETURN NULL;
      END IF;

      o := to_jsonb(OLD);
      n := to_jsonb(NEW);
      FOREACH col IN ARRAY watched LOOP
        IF (o -> col) IS DISTINCT FROM (n -> col) THEN
          diff := diff || jsonb_build_object(col, jsonb_build_object('from', o -> col, 'to', n -> col));
        END IF;
      END LOOP;

      IF diff <> '{}'::jsonb THEN
        INSERT INTO ticket_change_events (ticket_id, op, changed, actor_id, caused_by_rule_id, chain_depth)
        VALUES (
          NEW.id, 'update', diff,
          nullif(current_setting('axiom.actor_id', true), '')::uuid,
          nullif(current_setting('axiom.rule_id', true), '')::uuid,
          coalesce(nullif(current_setting('axiom.chain_depth', true), '')::int, 0)
        );
      END IF;
      RETURN NULL;
    EXCEPTION WHEN OTHERS THEN
      -- Never take down the write that fired us. See the note above.
      RETURN NULL;
    END;
    $fn$ LANGUAGE plpgsql;
  `),
  );

  await db.execute(
    sql`DROP TRIGGER IF EXISTS "tickets_change_capture" ON "tickets"`,
  );
  await db.execute(sql`
    CREATE TRIGGER "tickets_change_capture"
      AFTER INSERT OR UPDATE ON "tickets"
      FOR EACH ROW EXECUTE FUNCTION ticket_change_capture()
  `);

  // ── Message capture ────────────────────────────────────────────────
  //
  // "A customer replied" is not a tickets diff, so it needs its own trigger.
  // Two paths into it: a new message, and a HELD message being approved —
  // the second is a real customer reply arriving late, and a rule watching
  // for customer replies must see it.
  await db.execute(
    sql.raw(`
    CREATE OR REPLACE FUNCTION message_change_capture() RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'UPDATE' AND NOT (OLD.moderation_status = 'held' AND NEW.moderation_status = 'approved') THEN
        RETURN NULL;
      END IF;

      INSERT INTO ticket_change_events (ticket_id, op, changed, message_facts, actor_id)
      VALUES (
        NEW.ticket_id, 'message', '{}'::jsonb,
        jsonb_build_object(
          'authorType', NEW.author_type,
          'isInternalNote', NEW.is_internal_note,
          'moderationStatus', NEW.moderation_status
        ),
        NEW.author_id
      );
      RETURN NULL;
    EXCEPTION WHEN OTHERS THEN
      RETURN NULL;
    END;
    $fn$ LANGUAGE plpgsql;
  `),
  );

  await db.execute(
    sql`DROP TRIGGER IF EXISTS "messages_change_capture" ON "messages"`,
  );
  await db.execute(sql`
    CREATE TRIGGER "messages_change_capture"
      AFTER INSERT OR UPDATE OF "moderation_status" ON "messages"
      FOR EACH ROW EXECUTE FUNCTION message_change_capture()
  `);

  // ── Verify, loudly ─────────────────────────────────────────────────
  //
  // A silently-missing trigger presents as "the engine works, but no event
  // rule ever fires", which is the worst failure mode this system has. Check
  // it here rather than trusting that the CREATE above did what it said.
  const triggers = (
    await db.execute(sql`
      SELECT tgname FROM pg_trigger
      WHERE tgname IN ('tickets_change_capture','messages_change_capture')
        AND NOT tgisinternal
    `)
  ).rows as { tgname: string }[];

  const found = new Set(triggers.map((t) => t.tgname));
  for (const t of ["tickets_change_capture", "messages_change_capture"]) {
    if (!found.has(t)) throw new Error(`trigger ${t} was not installed`);
  }

  const [rules] = (
    await db.execute(sql`SELECT count(*)::int AS n FROM "automation_rules"`)
  ).rows as { n: number }[];
  const [events] = (
    await db.execute(sql`SELECT count(*)::int AS n FROM "ticket_change_events"`)
  ).rows as { n: number }[];

  console.log(
    `automation rules ready — ${rules?.n ?? 0} rules, ${events?.n ?? 0} queued change events, ` +
      `both triggers installed, ${WATCHED_COLUMNS.length} columns watched`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
