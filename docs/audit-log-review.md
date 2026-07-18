<!-- Multi-agent audit-log review (10 agents), 2026-07-14. Reference doc; the P0 UI + P1 data-model/integrity changes were shipped separately. -->

# Audit Log — Senior Engineering Review

*Axiom Ticketing System · prepared for the developer · 2026-07-14*

---

## TL;DR verdict

The audit log's **bones are good and its trust story is not**. The read/query architecture is genuinely well-built — keyset pagination, server-side filtering, joined (non-N+1) reads, and a streaming CSV export are all already correct — and the data model captures a sensible who/what/where skeleton with role-snapshot foresight and impersonation tracking. But the **presentation layer is a flat forensic dump** that buries "who did what to what" and dumps two un-diffed JSON blobs in the detail modal, and the **integrity story is effectively fiction**: the "append-only via DB grants" claim in the schema comment is false (there is no `REVOKE`, trigger, or WORM anywhere, and the app connects as the table owner, which bypasses grants regardless), there is no tamper-evidence, and the audit-log export is itself unaudited. Net: this is a competent **success-only change feed with a rough UI**, not yet a defensible compliance-grade audit trail. The fixes are well-scoped and mostly additive — nothing here requires an architectural rewrite.

---

## Current state (grounded in the code)

**Data model** — `src/lib/db/schema/audit.ts`. Thirteen columns: `id` (random UUID PK), `timestamp` (timestamptz, `now()`), `request_id`, `actor_id` (FK→users, **`onDelete: set null`**), `actor_role_snapshot`, `impersonator_id` (FK→users, `set null`), `action` (the only NOT-NULL classifier), `target_type`/`target_id` (polymorphic `text`), `before_value`/`after_value` (two independent nullable `jsonb` blobs), `ip_address`, `user_agent`. Five indexes, all covering the *filter* column but **not** the `ORDER BY timestamp DESC, id DESC` sort. No outcome, no severity, no category, no reason, no session id, no actor-name snapshot, no target label, no sequence number, no retention/partitioning.

**Writer** — `src/lib/audit.ts`. Single `audit()` entry point; auto-stamps `impersonatorId` from the active impersonation context. Two structural weaknesses: the insert is **not transactionally bound** to the mutation it records (a committed change whose audit insert throws leaves a silent gap), and it accepts arbitrary `unknown` JSON with **no redaction or allow-list**.

**List UI** — `src/app/(admin)/admin/(gated)/audit/page.tsx`. Six columns: Timestamp (mono), Actor, Action, Target, IP Address, details button. Dense `text-xs` table; every row looks identical, so the eye has no scan anchor. Six flat filter inputs (exact-match `eq` only, no free-text search, no category dimension). Fixed sort. Cursor keyset pagination via the `<AuditLoadMore>` island — which has **two real bugs**: appended rows render the **raw action code** (`ticket.resolve`) instead of `auditActionLabel()`, and use different cell padding, so column 1 misaligns after the first "Load more". A Zod filter-validation failure returns `{rows:[]}` — indistinguishable from "no data".

**The modal problem** — `src/components/audit/details-modal.tsx`. This is the worst offender. It renders the **entire before object AND the entire after object as two independent blocks** — no pairing, no change highlighting, unchanged fields duplicated across both. For any `update` the reviewer must eyeball-diff two ~80%-identical JSON blobs. It also promotes three engineering values to first-class rows (request id, raw target UUID, raw role-snapshot string), renders `timeStyle:"long"` (seconds + timezone — over-precision), leaks raw `JSON.stringify` for arrays/nested values, resolves only *user* UUIDs (org/ticket ids fall back to raw UUIDs), renders null email as a literal `(—)`, and **fetches `user_agent` but never displays it**.

---

## What a great audit log looks like (the target)

1. **Rows are events, not tuples.** Each row answers *who did what to what, when* in a single scannable summary sentence, with a category color rail + icon as the peripheral-vision scan channel.
2. **The detail view is a diff, not a dump.** One changed-fields-only `old → new` table; unchanged fields collapsed; raw JSON/IDs hidden behind a toggle.
3. **It is self-contained.** Actor name/email, target label, and role are snapshotted at write time, so a record survives deletion of the referenced rows without a live join.
4. **It records outcomes, not just successes.** Denials and failed logins live in the same queryable stream (via an `outcome` dimension or `.failed`/`.denied` action suffixes), because that's where investigations start.
5. **It is tamper-evident.** A gapless sequence + hash chain makes deletion/backdating/reordering *detectable*; immutability is enforced at the DB by a least-privileged role that is not the table owner.
6. **It audits itself.** Exports and (ideally) sensitive reads emit their own events.
7. **It is searchable and filterable by dimension** (free-text + category + presets), and it scales — indexes match the sort, retention is bounded by partitioning.

---

## Prioritized recommendations

### P0 — Quick wins (UI/UX, the modal, friendly summaries, filters)

These are mostly render-layer and unblock the biggest daily-usability pain. None require a schema migration.

- **Fix the load-more bugs** — apply `auditActionLabel()` + `title` and match server cell padding in `load-more.tsx`. Also carry "last rendered day" state so day grouping doesn't emit duplicate/orphan headers across the page cut. **(S)** — *table stakes; the list currently contradicts itself between page 1 and page 2.*
- **Rewrite the modal as a single 3-column diff** (`~`/`+`/`–` classification over `before ∪ after`, unchanged fields collapsed behind "Show N unchanged"). Reuse category color semantics: green=add, red=remove, amber=change. For create/delete show a single "Created with"/"Deleted values" table. **(M)** — *this is the single highest-leverage UX change; it converts an eyeball-diff chore into a glance.*
- **Collapse engineering noise behind a "Raw details" disclosure** (entry id, request id, raw target UUID, role snapshot, IP, **user-agent** — finally given a home, and the pretty-printed before/after JSON). Omit null fields entirely instead of rendering `—`/`(—)`. Drop `timeStyle:"long"` for `Jul 14, 2026 at 3:58 PM · 2 hours ago`. **(S)**
- **Friendly summary sentences** in the row via an action-keyed template layer (`{Actor} changed {Field} {old} → {new} on {target}`), always falling back to `auditActionLabel()` — never the raw code. **(M)** — *this is what makes the stream scannable, and it structurally prevents the raw-code regression.*
- **Redesigned row layout** (see ASCII below): category color rail + icon, actor avatar, summary sentence, relative time; drop the IP column and the separate Action/Target columns; whole row is the click target. Add sticky day-group headers. **(M)**
- **Filter UX overhaul:** add **free-text search** (scope honestly to actor name + action label + target id until denormalized text exists — label the placeholder to match), a **category multi-select** (derive `domain.verb` → category server-side; group the picker by category), date **presets** (Today/7d/30d/Custom), actor **combobox** with avatars, target-id as **contains** (`eq`→`ILIKE`), and **active-filter chips** with "Clear all". **(M)**
- **Distinct empty/error states:** skeleton rows on initial load; separate "no events match these filters" (with Clear-filters) from "no activity yet"; a real error card + Retry when the Zod validation fails, instead of a silent empty table; a Retry on load-more errors. **(S)**
- **Fix the date-range off-by-one** in `buildWhere` (audit.ts:113): `to` = `2026-07-14` currently becomes `<= 2026-07-14T00:00:00Z`, excluding nearly all of that day. Make the end genuinely end-exclusive (`end + 1 day`, `lt`). **(S)** — *correctness; affects every date filter today.*
- **Taxonomy hygiene** in `action-label.ts`: add labels for the emitted-but-unlabeled `user.impersonation.start/end` and `ticket.csat.*`; retire the dead `procurement.approve` and `ticket.add_collaborator`. **(S)**

### P1 — Data-model additions + coverage gaps

These require migrations (all backward-compatible: added columns are nullable or defaulted, so they ship ahead of writer changes) and new `audit()` call sites.

- **Snapshot actor identity + target label at write time** — add `actor_name`, `actor_email`, `impersonator_name`, `impersonator_email`, `target_label`. **The snapshot becomes the source of truth**; the FK stays only as a soft reference. This fixes the deletion-attribution hole, removes per-render lookups, and gives search stable text. **(M)** — *proposed columns; this is the keystone data-model change that unblocks the row/modal redesign's actor and target rendering.*
- **Stop the log being mutated on user deletion** — change `actor_id`/`impersonator_id` from `onDelete: set null` to `no action`/`restrict` (or drop the FK and keep a raw uuid). With the name/email snapshot in place, dropping the FK is cleanest. **(S)** — *today, deleting a user silently rewrites historical rows — a self-inflicted immutability violation.*
- **Add an `outcome` dimension** — `outcome text NOT NULL DEFAULT 'success'` (+ optional `failure_reason`). Keeps every existing call site valid, and unlocks recording denials/failures in the same queryable stream. **(S)** — *proposed.*
- **Denormalize `category` + `severity`** (proposed `category`, `severity DEFAULT 'info'`, or at minimum a `GENERATED … split_part(action,'.',1)` category column) so the category filter is a stored lookup rather than a server-side prefix-expansion dance, and severity-tiered retention/alerting becomes possible. **(M)** — *proposed.*
- **Cover the auth + export forensic gaps** (see the checklist table): audit-log export, reports export, successful login, logout, per-attempt failed login, self-service password-reset completion, invite/setup password set, explicit role grant/revoke, inbound-email rejection drops, and the monthly plan-reset cron. **(M–L)** — *these are the events investigations actually start from; several are pre-auth so populate `ip`/`user_agent`/attempted-identifier-in-`target_id`.*
- **Index the filters to match the sort** — rebuild the four secondary indexes with a `timestamp DESC, id DESC` suffix (`CONCURRENTLY` on a live table) so one range scan serves both `WHERE` and `ORDER BY`; today a filter on a common `action` triggers a large sort on every page. **(M)**
- **Fix the two scale traps in the dropdown/export paths** — the unbounded `SELECT DISTINCT` for filter dropdowns (source actions from the code taxonomy; actors via a recursive skip-scan or active-staff query) and the export `BATCH=500` clamp silently capped to 200 by `listAuditEntries` (raise the internal cap or bypass per-batch re-checks). **(S–M)**
- **Wrap the audit insert in the mutation's transaction** (or a transactional outbox) so a committed change can never lack its audit row. **(M)**

### P2 — Tamper-evidence, retention, exports, alerting

The compliance-grade tier. Do these before anyone calls this a defensible audit trail for SOC 2 / ISO 27001 / HIPAA / PCI.

- **Enforce append-only for real** — run the app as a least-privileged role (`INSERT, SELECT` only) that is **not** the table owner, plus a belt-and-suspenders `BEFORE UPDATE OR DELETE` trigger that `RAISE EXCEPTION`s. Add it as a real migration and **fix the false comment** at `audit.ts:12`. **(M)** — *the current claim is unbacked; UPDATE/DELETE are fully available today.*
- **Add tamper-evidence** — a gapless `bigserial seq` (order and keyset by it instead of the random-UUID tie-break, which today breaks same-instant ties non-deterministically) plus a hash chain (`row_hash = SHA256(canonical(row) + prev_hash)`), with a verifier job that walks the chain and alerts on breaks, and periodic external anchoring to WORM storage. **(L)** — *proposed; `seq` alone catches reordering, the chain catches deletion/forgery.*
- **Audit the audit** — emit `audit.export` (actor, filter set, row count) inside `api/audit/export/route.ts`, and the same for `reports/export`. Optionally emit a detail-open/read event. **(S)**
- **Redact secrets in the writer** — an allow-list/redaction pass in `audit()` stripping `password`/`*token*`/`*secret*`/`apiKey`, and **stop writing the raw session token into `targetId`** in `session.revoke` (`profile.ts:300`) — store a token hash or session id. **(M)** — *these are bearer-credential-shaped values in a broadly-readable, exportable table.*
- **Retention + legal hold** — monthly range partitioning by `timestamp` (retention becomes `DROP PARTITION`, not a mass `DELETE` indistinguishable from tampering), a documented retention floor/ceiling, and a legal-hold flag. Never purge without the append-only tier intact. **(L)**
- **Export integrity** — emit a signed manifest (SHA-256 of the file + row count + filter range) so exported evidence is verifiable. **(M)**
- **Alerting pipeline** on high-risk events — permission/role grants (esp. Super Admin), impersonation start, mass-delete volume thresholds, failed-login bursts, any audit-log export. Route to SIEM/on-call. **(M)**
- **Free-text search infra** — generated `search_tsv` (GIN) over the denormalized metadata + before/after, queried as a *filter* (keep `timestamp DESC, id DESC` order; don't rank), plus `pg_trgm` on `target_id`/`actor_email` for fragment lookups. **(M)** — *depends on the P1 denormalization.*
- **Reconsider default-granting `audit.view` to all staff** given the PII content; scope broad read to a compliance/security role. **(S)**

---

## Redesigned row layout

Two-line "feed table" rows under sticky day headers. The **color rail + category icon** is the scan anchor; the **summary sentence** is the star; the **avatar** answers "who"; **relative time** sits right. IP, request id, target UUID, and both snapshots leave the row entirely.

```
  Today                                                              14 events
 ┌───────────────────────────────────────────────────────────────────────────┐
 │▎🛡  [ER] Evelyn Reyes reset the password for Marco Luqman        2m ago  › │
 │ sec       IT Director · user                                    3:58 PM     │
 ├───────────────────────────────────────────────────────────────────────────┤
 │▎✏  [MR] Marco Rueca changed Priority  Low → High  on            18m ago  › │
 │ upd       Technician · [KEND-2026-0412]                         3:41 PM     │
 ├───────────────────────────────────────────────────────────────────────────┤
 │▎🗑  [ER] Evelyn Reyes deleted work-log entry (45m) on           1h ago   › │
 │ del       IT Director · [KEND-2026-0388]                        3:04 PM     │
 ├───────────────────────────────────────────────────────────────────────────┤
 │▎⚙  [··] System auto-closed ticket after 7 days idle            2h ago   › │
 │ sys       automated · [KEND-2026-0355]                         1:20 PM     │
 └───────────────────────────────────────────────────────────────────────────┘
```

Category derivation (render-time classifier, precedence `security → billing → delete → create → update → system`): green=additive, red=destructive, blue=neutral change, **violet reserved for security** (never confused with delete-red), amber=money, zinc=machine (deliberately low-attention). Category is never encoded by color alone — the icon + chip label carry it for colorblind users. Impersonation shows a violet "↝ acting as" pill in the sentence; a null actor renders as "Deleted user · former IT Director" (from the role snapshot), never a bare em-dash.

---

## Redesigned modal — field-level before→after, raw behind a toggle

**Before (today):** two independent full-object blocks, no pairing, unchanged fields duplicated, three engineering IDs as first-class rows, raw JSON fallbacks, `user_agent` fetched-but-hidden.

**After:** header carries category + summary + humane time; only Actor and Target sit above the fold; the **diff is the center of gravity**; everything opaque is one disclosure away.

```
 ┌──────────────────────────────────────────────────────────── ✕ ┐
 │ ▎✏ UPDATE                                                       │
 │ Marco Rueca changed 2 fields on KEND-2026-0412                  │
 │ Jul 14, 2026 at 3:41 PM · 18 minutes ago                        │
 ├─────────────────────────────────────────────────────────────── │
 │ Actor    [MR] Marco Rueca · Technician                          │
 │          marco@axiom.com                                        │
 │ Target   Printer jam, floor 3 · ticket           open →         │
 ├─────────────────────────────────────────────────────────────── │
 │ CHANGES  (2 changed · 1 added · 1 removed)     [Show 6 unchanged]│
 │ ┌───┬───────────────┬──────────────────┬──────────────────────┐ │
 │ │   │ Field         │ Before           │ After                │ │
 │ ├───┼───────────────┼──────────────────┼──────────────────────┤ │
 │ │ ~ │ Priority      │ L̶o̶w̶              │ High                 │ │  amber
 │ │ ~ │ Assignee      │ U̶n̶a̶s̶s̶i̶g̶n̶e̶d̶      │ Marco Rueca          │ │  amber
 │ │ + │ Tags          │ —                │ urgent, vip          │ │  green
 │ │ – │ Due date      │ J̶u̶l̶ ̶2̶0̶,̶ ̶2̶0̶2̶6̶    │ —                    │ │  red
 │ └───┴───────────────┴──────────────────┴──────────────────────┘ │
 │                                                                 │
 │ ▸ Raw details                                                   │
 │   ─ expanded ─────────────────────────────────────────────────  │
 │   Entry ID     f0a1…  (copy)     Request ID   3f9a…  (copy)      │
 │   Target       ticket · 3f9a1c2e-…  (copy · open →)             │
 │   IP address   203.0.113.7        Session     s_92h…            │
 │   User agent   Mozilla/5.0 (Macintosh; …)   ← finally shown     │
 │   Role snap    ["it_director"]    Impersonator  —               │
 │   before_value { …pretty JSON… }  after_value  { …pretty JSON… }│
 └─────────────────────────────────────────────────────────────────┘
```

Field-level diff rules: key-union of `before ∪ after`; classify each field changed/added/removed/unchanged; **hide unchanged behind a toggle**; humanize keys (`assigneeId`→"Assignee"), resolve values (user UUIDs→names, enum codes→labels, ISO→friendly), render nested objects as a compact readable summary — **never inline `JSON.stringify`**. `create` collapses to a two-column "Created with"; `delete` to "Deleted values". Omit null fields; the only legitimate `—` is a diff cell meaning "did not exist on that side". Below `sm`, the table reflows to stacked per-field blocks — it never horizontal-scrolls.

---

## Missing audit events — checklist

| Event | Severity | Why it matters |
|---|---|---|
| **Audit-log CSV export** (`api/audit/export/route.ts`) | **P0 Critical** | Streams the entire log — actor emails, before/after PII — with no audit entry. A privileged user exfiltrates everything and the trail can't show who. "Who watches the watchers." |
| **Password-reset completion — self-service forgot** (`lib/auth/index.ts sendResetPassword` / Better Auth hook) | **P0 Critical** | The actual credential mutation on the account-takeover-via-reset path. Admin-initiated reset *is* audited; the attacker's path writes nothing. |
| **Password set via invite/setup** (`app/actions/setup.ts setupPassword`) | **P0 Critical** | Same class as above; `user.set_password` label exists but is never emitted from setup. |
| **Failed login (per attempt)** (`sign-in.ts` failure branch) | **P0 High** | Only the lockout *threshold* (`user.locked`) is recorded. Per-attempt failures are the primary signal for credential-stuffing / spray / brute-force; investigations start here. Emit `auth.login_failed` (actor null; populate ip/ua/attempted-email). |
| **Successful login** (`sign-in.ts` success path, ~line 149) | **P1 High** | Establishes the access baseline; without it you can't correlate a sign-in to a preceding failed-attempt burst or answer "who was in the system when." |
| **Explicit role grant/revoke to a user** (`users.ts` ~line 378) | **P1 High** | Privilege escalation is only recoverable today by eyeball-diffing a `user.update` blob. Needs a first-class, filterable `user.grant_role`/`user.revoke_role`. |
| **Reports CSV export** (`api/reports/export/route.ts`) | **P1 Medium** | Second untracked data-export surface. (Aggregate metrics, non-PII — so hygiene/accountability rather than exfil — but "data export" should be a recorded action.) |
| **Inbound-email rejection / drop** (`process-inbound-email.ts` lines 185, 759, 775, + no-ticket/closed/loop-limit) | **P1 Medium** | 5+ silent drop branches. The loop-detection drop (>5 msgs/5 min) is a mail-bomb signal; the unauthorized-sender drop is inbound probing — both leave only a Pino line. |
| **Monthly plan reset (cron)** (`inngest/functions/monthly-plan-reset.ts`) | **P1 Medium** | Financially significant automated mutation (zeroes every org's balance, clears alert flags) with no record — a zeroed balance is otherwise unexplained. |
| **Logout / sign-out** (`profile.ts` / Better Auth `signOut`) | **P2 Low** | Bounds sessions; lower value than login but completes the session lifecycle. |
| **Over-plan alert fired** (billing) | **P2 Low** | Ties the accountant notification to a durable record; the monthly reset can otherwise mask over-plan usage. |
| **Webhook signature-verification failure** (Twilio status + inbound-email routes) | **P2 Low** | Detects forged/replayed webhook calls. |
| **Password-reset *requested*** (`lib/auth/index.ts sendResetPassword`) | **P2 Low** | Pairs with the P0 completion event so request→complete correlates — an account-enumeration signal. |
| **Attachment / bulk data download** (if a download route exists) | **P2 Low** | Closes the read-exfil gap that state-change-only auditing structurally misses. |
| **`user.delete`** (guardrail — no hard-delete exists today) | **P2 Dormant** | Deactivation-only today, so dormant. But if hard-delete is ever added it *must* emit this, because the `set null` FKs strip actor attribution from historical rows on user deletion. |

**Cross-cutting:** several rows above are *failure/denied* events. Until an `outcome` column lands (P1 data-model), encode outcome in the action-key suffix (`.failed`/`.rejected`) so they fit the current success-only table; for pre-auth failures the only forensic anchors are `ip_address`, `user_agent`, and the attempted identifier in `target_id` — populate all three.

---

## Key files

- List page — `src/app/(admin)/admin/(gated)/audit/page.tsx`
- Server actions (filters, keyset, export, date bug at :113, dropdown DISTINCT) — `src/app/actions/audit.ts`
- Load-more island (raw-code + padding bugs, day-boundary state) — `src/components/audit/load-more.tsx`
- Details modal (diff rewrite) — `src/components/audit/details-modal.tsx`
- Action labels + new category classifier + summary templates — `src/lib/audit/action-label.ts`
- Schema + indexes + FK change (data-model asks) — `src/lib/db/schema/audit.ts`
- Writer (txn binding, redaction) — `src/lib/audit.ts`
- Unaudited exports — `src/app/api/audit/export/route.ts`, `src/app/api/reports/export/route.ts`
- Session token in `targetId` — `src/app/actions/profile.ts:300`
- False immutability claim — `src/lib/db/schema/audit.ts:12`; missing REVOKE/trigger — `src/lib/db/migrations/0000_sleepy_shockwave.sql`