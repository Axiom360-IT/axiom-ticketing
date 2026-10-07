# Automation Rules — architecture

Status: **Phase 1 shipped** · Owner: platform · Last revised: 2026-10-07

A user-editable rule engine: **when** something happens, **if** conditions hold,
**then** do things. This document is the contract the code is written against.
If the code and this file disagree, one of them is a bug.

---

## 1. Context

Nine scheduled jobs and nine reactive ones already run (see
`src/lib/automations/registry.ts`). Every one of them is hard-coded: adding
"text the on-call technician when a critical ticket sits unassigned for 30
minutes" means a code change, a review and a deploy.

The goal is to make that an afternoon's configuration instead, without
weakening the jobs that already work.

### Non-goals

- **Rewriting the existing 18 jobs as rules.** They are tested, tuned and
  load-bearing. The SLA monitor's 20-minute cadence, 500-ticket batch and
  three-tier channel escalation encode real operational decisions. The rule
  engine is strictly *additive*: existing jobs keep their code and keep their
  cards on the Automations page.
- **A visual node graph.** Demos well, worse to use than a sentence for
  everything an operator actually writes.
- **A general workflow runner.** No branching, no joins, no human-approval
  steps. Rules are flat: one trigger, one condition tree, a list of actions.

---

## 2. The constraint that drives the design

A rule engine needs to know when a ticket changed. Counted on 2026-10-07:

| | count |
|---|---|
| `.update(tickets)` call sites | 58 (56 outside backfill scripts) |
| `.insert(tickets)` call sites | 7 |
| `notification/dispatch` emit sites | 30 |
| ticket lifecycle events on the Inngest bus | 1 (`ticket/created`) |

Those 65 write sites span server actions, `lib/mcp/tickets-write.ts` (a
parallel mutation path used by the AI connector), the Inngest functions
themselves, and `lib/tickets/csat-apply.ts`.

**There is no chokepoint.** Hand-emitting an event from each site needs 65
correct edits today and perfect discipline forever. The MCP tools would drift
first, because they re-implement the same mutations.

### Decision 1 — capture change in the database, not the application

One trigger on `tickets`, `AFTER INSERT OR UPDATE FOR EACH ROW`, writing a row
into a `ticket_change_events` outbox: ticket id, operation, and the old/new
values of **only** the columns the engine watches.

Why:

- **Complete by construction.** Server action, MCP tool, cron job, backfill
  script, or hand-typed SQL — all produce an event. There is no
  "remembered to emit" failure mode because there is nothing to remember.
- **Atomic.** The trigger runs inside the writer's transaction: the event
  commits with the change or rolls back with it. Strictly better than
  `inngest.send()` after a commit, which loses the event if the process dies
  in between — a bug class that already exists at several of the 30 dispatch
  sites.
- **Precedent.** `migrations/0021_audit_log_hardening.sql` already installs
  `audit_log_prevent_mutation()` as a trigger, for the same reason: app-layer
  discipline was not enough, so the guarantee moved into the database.

**The trigger contains no business logic.** It records a diff. Every decision
stays in TypeScript where it is testable. This is the transactional-outbox
pattern, not clever PL/pgSQL.

Costs, accepted knowingly:

- One extra INSERT per ticket write. Ticket volume here is tens per day.
- The trigger is invisible in the Drizzle schema files. Mitigated by a
  documented migration (`pnpm db:add-automation-rules`) and a test that asserts
  the trigger exists and fires.
- `WATCHED_COLUMNS` is duplicated in SQL and TypeScript. A test asserts they
  match.

---

## 3. The model

```
WHEN    a trigger fires
IF      a condition tree evaluates true
THEN    run actions in order
UNLESS  the dedupe policy says this already fired
```

### Three trigger families

| Family | Fires because | Driven by |
|---|---|---|
| `event` | something changed | the change feed |
| `state` | something has *been true* for N minutes | a periodic scanner |
| `schedule` | the clock reached a local wall-clock time | a dispatcher, as scheduled reports already do |

The `state` family is the one most rule engines get wrong. "Unassigned for 30
minutes" is not an event — nothing happens at minute 30. It needs a scanner
that asks "which tickets match *now*?". The existing SLA, unassigned and
follow-up monitors all work this way for the same reason.

### Condition tree

One level of nesting, `all` / `any` at each level. Deeper nesting buys
expressiveness nobody uses and costs comprehensibility everybody pays for.

```ts
{ combinator: "all", conditions: [
    { field: "priority", operator: "is", value: "critical" },
    { combinator: "any", conditions: [ … ] },
] }
```

### Dedupe policy

| policy | meaning | key |
|---|---|---|
| `always` | every time the trigger fires | not recorded |
| `once_per_ticket` | at most once ever, per ticket | `rule:ticket` |
| `once_per_occurrence` | once per distinct occurrence (e.g. each breach) | `rule:ticket:occurrence` |
| `throttle` | at most once every N minutes, per ticket | `rule:ticket:window` |

Backed by the `rule_fires` ledger. Same idea as `sla_warning_50_at` on
`tickets` and `last_run_on` on `scheduled_reports` — generalised, because a
generic engine cannot add a column per rule.

---

## 4. Invariants

These are the properties the tests exist to protect. Each one is a way the
system would otherwise break in production.

**I1 — No loops.** Every change event records its actor. A change caused by a
rule does **not** re-trigger rules unless that rule sets `allowChaining`. Chain
depth is capped at `MAX_CHAIN_DEPTH = 3` regardless.

**I2 — Bounded blast radius.** Three layers: a per-run match cap
(`MAX_MATCHES_PER_RUN = 200`, logged when it truncates, never silent); a
dry-run preview that states how many tickets match *before* save; and a
per-rule hourly action budget that trips the rule to `paused — hit its limit`
rather than continuing.

**I3 — Claim before act.** The `rule_fires` row is written before the actions
run. A crash mid-batch loses the remainder rather than duplicating it. Same
rule the report dispatcher follows.

**I4 — Deterministic order.** Rules run in `order`, then `createdAt`. A rule
may set `stopOnMatch` to prevent later rules running for that ticket.

**I5 — Broken beats silent.** A rule naming a deactivated user, a deleted
category or a renamed role is marked `broken` with the reason and skipped. It
never silently does nothing and never fires at the wrong person. References
resolve at run time, never at save time.

**I6 — Same blast radius, same gate.** A rule can email arbitrary addresses and
change ticket data, so it is gated on `settings.update` — exactly as scheduled
reports are. Deliberately *not* a new permission: a new one needs an explicit
`can()` case to dodge the `default: return true` fall-through, plus a
`db:add-*-permission` script because `pnpm db:seed` no-ops on a live database.
Re-auth to create/edit/delete; no re-auth to pause (reversible, only ever does
less).

**I7 — The brain is pure.** `evaluate()` imports nothing. No `server-only`, no
db, no Resend. Every operator, every time window, every combinator is unit
tested. The DB-touching executor stays thin. This is the split that made
`schedule.ts` fully testable while `reports.ts` is not.

**I8 — The catalog cannot lie.** Every catalog trigger has a producer, every
condition field has an evaluator branch and a fact, every action has an
executor, and every one has wording in `en.json`. Asserted by
`catalog.test.ts`, following `registry.test.ts`.

**I9 — Local time means local.** Business-hours, weekday and schedule logic go
through `safeLocalMoment` and `business_hours.timezone`. Already DST-tested.

**I10 — One query per trigger shape.** The scanner groups rules by what they
scan and issues one batched query per shape, not one per rule. The SLA monitor
was widened 5min → 20min for Neon's compute budget; this engine must not undo
that.

**I11 — Existing automations are untouched.** No existing Inngest function,
setting key or table changes. The engine adds three functions, four tables and
one trigger. Verified by the pre-existing test suite staying green.

---

## 5. Data model

Four tables. Shapes mirror `scheduled_reports` so they read alike.

### `automation_rules`
The rule itself. `trigger`, `conditions`, `actions` are `jsonb`, validated by
zod on write and re-validated on read (a row can predate a catalog change).
`enabled`, `order`, `stopOnMatch`, `allowChaining`, `dedupe`, `brokenReason`,
`lastFiredAt`, `firesToday`, audit columns.

### `ticket_change_events`
The outbox. `ticketId`, `op`, `changed` (jsonb: `{col: {from, to}}`), `actorId`,
`causedByRuleId`, `chainDepth`, `createdAt`, `processedAt`. Drained then
deleted on a retention window.

### `rule_fires`
Idempotency ledger. Unique on `(ruleId, ticketId, occurrenceKey)`.

### `rule_action_log`
What each firing actually did, per action, with outcome and error. This is what
makes *"why did my customer get that email?"* answerable.

Rule run history folds into the existing `automation_runs` under
`rule:<uuid>` ids — the same convention `scheduled-report:<uuid>` uses — so the
Automations page's health badges, failure counts and retention pruning work
unchanged.

---

## 6. Module map

Pure (no imports, unit tested):

| file | job |
|---|---|
| `lib/rules/types.ts` | the shapes |
| `lib/rules/catalog.ts` | triggers, condition fields, operators, actions |
| `lib/rules/evaluate.ts` | `evaluate(rule, facts, now) → Decision` |
| `lib/rules/describe.ts` | rule → one English sentence |
| `lib/rules/schema.ts` | zod validation + normalisation |

Impure (`server-only`, thin):

| file | job |
|---|---|
| `lib/rules/facts.ts` | ticket id → `FactSheet` |
| `lib/rules/store.ts` | CRUD + ordering |
| `lib/rules/fires.ts` | the `rule_fires` ledger |
| `lib/rules/execute.ts` | action executors |
| `lib/rules/changefeed.ts` | drain outbox → domain events |
| `lib/rules/scan.ts` | state-trigger candidate queries |
| `lib/rules/preview.ts` | dry run: which tickets match now |
| `lib/rules/engine.ts` | the loop that ties them together |

Inngest:

| function | trigger | job |
|---|---|---|
| `rule-event-dispatcher` | `*/2 * * * *` | drain the outbox, run `event` rules |
| `rule-state-scanner` | `*/10 * * * *` | run `state` rules |
| `rule-schedule-dispatcher` | `*/5 * * * *` | run `schedule` rules |

All three are registered in `AUTOMATIONS` so they get cards, run history,
health badges and an off switch like everything else.

---

## 7. Operator surface

A generic if/then builder is powerful and horrible. Four things fix that.

1. **Templates are the front door.** The page opens on a library of prewritten
   rules for this business, not a blank form. Click, adjust two numbers, save.
2. **The editor is a sentence.** *When **a ticket is created** · and
   **priority is Critical** · and **client is Acme** · then **text the on-call
   technician***. Each bold part is a dropdown.
3. **It states the consequence before you commit.** "Right now this matches 7
   open tickets", with the list. No rule is ever saved blind.
4. **The card reads in English.** Generated by `describe.ts`. No jsonb is ever
   shown to a human — the same treatment that turned `*/5 * * * *` into "every
   five minutes".

Plus a per-rule log answering *"why didn't it fire?"* with the condition that
failed. That single feature prevents most of the support load a rule engine
creates.

---

## 7a. Decisions taken during the build

Four things the plan did not anticipate. Each is load-bearing.

**A second trigger, on `messages`.** "A customer replied" is not a `tickets`
diff. `messages_change_capture` fires on INSERT and on a held reply being
APPROVED — the second is a real customer reply arriving late, and a rule
watching for replies has to see it.

**System messages produce no events.** The `internal_note` action writes a
message with `author_type = 'system'`, which the trigger faithfully records.
`eventsFromDiff` checks `authorType === "system"` *before* `isInternalNote`,
so that note cannot read as `note_added`. Without that ordering, a rule
triggered by a note whose action posts a note would run until something
stopped it. This is the loop guard that has teeth today, because
`causedByRuleId` cannot be populated until mutating actions ship.

**`applyToExisting`, defaulting off.** There is no `status_changed_at` column,
so `minutes_in_status` falls back to the ticket's age for anything that has
not moved since the engine was installed — which over-reports the wait. Saving
"alert me when a ticket has been open a week" would therefore fire across the
whole backlog on its first pass, and larger than the truth. State rules now
ignore tickets whose waiting began before the rule was written unless the
operator ticks the box, and the preview tells them exactly how many they are
excluding.

**A scheduled rule acts per ticket.** At its appointed time it evaluates every
open ticket and acts on each match — not one digest. That is what makes "every
morning, flag any critical ticket nobody has picked up" expressible, and
digests already exist as scheduled reports. Consequence: every dedupe policy
is meaningful on a schedule rule, since it does hold a ticket. The dispatcher
claims the local DATE before doing any work, so a schedule rule runs once a
day whatever its policy says.

## 8. Rollout

Phase 1 ships the spine with **safe actions only** — notify, internal note,
flag. A rule cannot modify a ticket until the loop guard (I1) has been observed
working in production. Mutating actions land in a later phase behind the same
engine.

Install with `pnpm db:add-automation-rules` (idempotent; verifies both
triggers landed and throws if either did not).

Rollback, in increasing order of severity:

1. Switch one rule off — the toggle on its card.
2. Switch the whole engine off — `rules.enabled`, which stops all three
   dispatchers. The triggers keep filling the outbox harmlessly and
   housekeeping prunes it, so switching back on resumes rather than replays.
3. Drop the triggers — two statements, affecting nothing else:
   `DROP TRIGGER tickets_change_capture ON tickets;`
   `DROP TRIGGER messages_change_capture ON messages;`

Nothing in this feature is on the path of creating, replying to or resolving a
ticket. The database triggers are the only code that runs inside someone
else's transaction, and both are wrapped in `EXCEPTION WHEN OTHERS THEN RETURN
NULL` so a problem in the outbox cannot fail the write that produced it.

## 9. What shipped, and what has not

Shipped: the change feed, both triggers, the pure evaluator (54 tests), the
catalog (41 condition fields, 28 event triggers, 9 state triggers), the three
dispatchers, the sentence-shaped builder, the dry-run preview, the per-rule
activity log with "why it did not act", 15 templates, and the four safe
actions — notify, internal note, record-only, and webhook.

Not shipped, deliberately: the thirteen mutating actions. They are in the
catalog, listed in the builder, and refused in two places — at the server
action and again in the executor. They land once the chain guard has been
observed working on real traffic.

Untested by a human: all of it. There is no test database and no jsdom in this
project, so nothing in `lib/rules` that touches the database or renders has
been exercised outside of `tsc`, `eslint` and the production build.
