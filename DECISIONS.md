# Architecture & policy decisions

A running log of decisions that aren't obvious from reading the code. New
entries go at the top; date them.

---

## 2026-08-19 · Coordinator + Super Admin now receive every staff-facing notification

Explicit ask: Super Admin (and, on follow-up, Coordinator too) should see
"every kind of notification" — email, SMS, and in-app — not just the subset
they were already broadcast on. This is a deliberate departure from several
rules in the req-6.1–6.4 notification matrix (`docs/notification-matrix.md`),
which intentionally scoped some events to a single role or to an
unassigned/no-staff-attributable fallback:

- `ticket.reassigned` was Super Admin only (req 3.2 oversight) — now also
  Coordinator.
- `ticket.escalated` always included Super Admin plus the chosen/default
  target — now Coordinator is always included too, regardless of target.
- `ticket.customer_replied` reached Coordinator only when the ticket was
  **unassigned** (a fallback so replies don't go unnoticed) — now Coordinator
  and Super Admin get it on every reply, unassigned or not. This is the
  highest-volume change of the set — every customer reply system-wide now
  additionally pings both roles.
- `ticket.csat_unsatisfied` was Coordinator + assignee only — now Super Admin
  too.
- `procurement.submitted`/`procurement.delivered` reached Coordinator-only
  and requester-only respectively — now both also reach Super Admin, and
  `procurement.delivered` reaches Coordinator too (previously no role at
  all, only the individual requester).
- `attachment.quarantined` reached Coordinator only when no staff was
  attributable (fallback) — now Coordinator + Super Admin always get it in
  addition to any attributable staff recipient.

Implementation: a single new `OVERSIGHT_ROLES = ["Coordinator", "Super
Admin"]` constant in `src/lib/notifications/audience.ts`, spread into
`recipientRoles` at each of the 7 affected dispatch call sites (both the
Server Action and MCP-tool mirror, where both exist) rather than hard-coded
per site — keeps a future "also add IT Director" change to one line.
Deliberately still routed through the existing `notification/dispatch` →
`notification_preferences` pipeline, not a hard bypass: a Coordinator or
Super Admin who finds a specific event too noisy can still turn off
email/SMS for just that event type in their own profile, same as any other
user. Nothing changed in `dispatch-notification.ts`, the preferences UI
components, or the schema — the existing default-opted-in behavior (a
missing preference row = fully enabled) already covered "off by default
unless someone turns it down," which is what was needed.

**Explicitly excluded, both flagged rather than silently decided:**
- **IT Director** — the ask named only Super Admin and Coordinator, twice.
  Not added to `OVERSIGHT_ROLES`.
- **Customer-facing events** (`ticket.assigned_customer`, `agent_replied`,
  `resolved`, `reopened`, `closed`) — left untouched. Those templates are
  written in the customer's voice ("your ticket…"); stapling a staff role
  into that recipient list would put second-person customer copy in a staff
  inbox. The matrix doc's own first principle ("never reuse one type across
  customer + staff") argues against it independent of volume concerns.
- `procurement.approved`/`procurement.rejected` remain dead (no producer —
  the approval workflow they belonged to doesn't exist in the current
  4-stage procurement pipeline; see the 2026-08-19 vendor-management entry
  below for the fuller note on this).
- The accountant-CC billing pathway (`getAccountantRecipients()`, a flat
  Settings contact list, not role-based) was left alone — Super Admin
  already has an opt-in switch for it (`billing.superadmin_receive_copy`,
  currently off live); Coordinator has no concept of membership in that
  system at all, and adding one would be a materially different, unprompted
  feature.

**SMS gap closed alongside this** (same ask: "whatever notifications we're
sending must have SMS too"): `ticket.unassigned_reminder`,
`procurement.submitted`, `procurement.delivered`, `attachment.quarantined`
got new `SmsTemplate` entries; `ticket.customer_replied` already had SMS
everywhere except the moderation-approve path, which was a plain
inconsistency, now fixed. `sla.warning_50` and `ticket.message_held` were
deliberately left in-app-only — both are pre-existing "low-noise heads-up"
designs (the former has an explicit code comment to that effect), not gaps.

Also found and fixed in passing: `ticket.message_held` existed as a
dispatched event with an in-app registry descriptor but had no entry in
`MANAGEMENT_EVENT_TYPES`/`TOGGLEABLE_EVENT_TYPES` — the one event type in
the whole system nobody could actually tune from their profile (or via the
`update_my_notification_preference` MCP tool, which would have rejected it
as "Unknown event type"). Added to `MANAGEMENT_EVENT_TYPES`.

---

## 2026-08-19 · Admin-managed vendor list + editable-after-the-fact vendor, accountant CC on procurement notifications

Three related procurement changes:

1. **New `vendors` table + `/admin/vendors`.** Mirrors the ticket-categories/types admin-taxonomy pattern (name, `is_active`, deactivate-never-delete, `settings.update`-gated CRUD) but deliberately **not** wired as a foreign key from `procurement_requests.vendor` — that column stays plain free text. The procurement form's vendor field is now a search-or-type-custom combobox (`VendorSelect`) that suggests active vendors but lets a requester submit any string; renaming/deactivating a vendor in the admin list never rewrites past requests, same reasoning as `messages.author_name` being a point-in-time snapshot rather than a live join. Seeded with the 27-vendor list currently in use (`pnpm db:add-vendors`).
2. **`updateProcurementVendor` revives the `procurement.update` permission.** That permission (and its `can()` scope rule — strict requesters can only act on their own request) has existed since the procurement domain was built but had no caller anywhere in the codebase. It's now used for "the requester corrects their own pick before it's actioned"; `procurement.manage` (Coordinator/Super Admin) additionally allows editing *any* request's vendor, matching who already owns stage changes. No new permission was added — both were already the right shape for this.
3. **Accountants get CC'd on procurement notifications.** `procurement.submitted` (on create) and `procurement.delivered` (on `order_completed`) now also email the `billing.accountant_emails` contact list (± Super Admin copy) via `getAccountantRecipients()` — the same resolver the billing pipeline (§15) uses. Sent as a direct best-effort `sendEmail` alongside the existing `notification/dispatch` call, not folded into it, because accountants aren't `users` rows and have no preferences row for the dispatcher to key off of.

Found and left alone (out of scope for this change, flagged for a future pass): `procurement_approval_threshold` (settings), and the `procurement.approved`/`procurement.rejected` notification types + email templates, are dead — leftover from a pre-CR-24 two-step approval workflow that was removed. Also found: this repo's drizzle-kit migration journal has been stale since migration `0018` — every schema change since (including this one) goes through a hand-written idempotent `pnpm db:add-*` script, not `pnpm db:migrate`. See the new callout in README §5.2 before running `pnpm db:generate` on a future change.

---

## 2026-08-17 · Bulk-imported customers get a synchronous, visible "provisioning" stage

The customer-import batch job (§17) never created a `users` row itself — it only fired an Inngest event, and the row only appeared once the async job's `provisionUser()` call reached that row. Between committing an import and the job finishing, an imported customer had **no database row at all** — invisible everywhere in the admin UI, no way to see "this import is still in flight," and a batch that never got picked up (Inngest down, function crash before any row processed) left zero trace of the attempt.

Fix: split `provisionUser()`'s work into three primitives (`lib/users/provision.ts`), all synchronous-vs-async decided by the caller, not the primitive:
- **`provisionUser()`** — unchanged for its two existing synchronous callers (`createUser`, `createUserViaMcp`); gained one field, `provisionedAt: new Date()`, so both remain immediately fully-provisioned.
- **`createCustomerImportStubs()`** (new) — `commitCustomerImport` calls this **synchronously**, before sending the Inngest event: one bulk INSERT for every row, `onConflictDoNothing` on `users.email`'s real unique constraint for atomic race safety (replacing a pre-check SELECT). `provisionedAt` stays null — that absence is the new signal.
- **`finishCustomerProvisioning()`** (new) — the Inngest job's async half; completes an already-existing stub (role grant, `accounts` row, sets `provisionedAt`) instead of creating one from scratch.

New `InviteStatus` value `provisioning` (`lib/users/invite-status.ts`), checked first — before the legacy "all timestamps null → active" fallback, since a brand-new stub has every invite timestamp null too and would otherwise misread as `active`. Users list: new filter option, a sky/blue badge (distinct from the amber/red "needs attention" palette — this one just needs a moment), bulk-select checkbox disabled, Edit/Deactivate hidden. `resetUserPassword`/`resetUserPasswordViaMcp` refuse to act on a still-provisioning row (no role/accounts row yet to reset against).

Trade-off accepted, not silently absorbed: a row that fails inside `finishCustomerProvisioning` is now visibly stuck (`provisioning` forever) rather than invisible — but unlike before this split, re-importing the same email no longer retries it (the row already exists, so re-import sees `duplicate_existing_customer`). No recovery tool built for this yet; flagged as a natural fast-follow rather than built speculatively.

New nullable `users.provisioned_at` column, migration `pnpm db:add-provisioned-at-column` — combines the usual `ADD COLUMN IF NOT EXISTS` with a one-time backfill (`provisioned_at = created_at` for every existing row, since every row genuinely was fully set up before this feature existed). Unlike this project's other `add-*` scripts, **the backfill is not safe to re-run** once the feature is live — it would wrongly mark a genuinely-stuck row as complete. Must be run before deploying the code that creates stub rows, not after (old `provisionUser()` inserts would otherwise reference a column that doesn't exist yet).

---

## 2026-08-17 · Production hotfix: server-side phone parsing must not import `react-phone-number-input`

Live 500 on every `/admin/users/import` commit (Vercel function logs: `TypeError: Super expression must either be null or a function`, during SSR module evaluation under Turbopack — the signature of a `class X extends undefined` failure). Root cause: `lib/customer-import/phone-normalize.ts` (a module reachable from the `"use server"` `commitCustomerImport` action) imported `parsePhoneNumber` from `react-phone-number-input`'s **root** export. That import doesn't just give you the parser — the root module also constructs the package's full class-based `<PhoneInput>` React component at module load and pulls in `prop-types`, `classnames`, `country-flag-icons`, `input-format`. None of that belongs in a server action's bundle, and it broke under Turbopack's SSR bundling even though a bare local Node import of the same function worked fine (the failure is bundler-specific, not a pure-logic bug).

Fix: import `parsePhoneNumber` from `libphonenumber-js/min` directly instead — the pure parsing engine underneath, zero React/class baggage. Added `libphonenumber-js` as an explicit `package.json` dependency (previously only reachable transitively, unresolvable under pnpm's strict linking). Added `phone-normalize.test.ts`, which had zero direct coverage before — the gap that let this ship without a local test catching it.

**Rule of thumb going forward:** never import a client/React-oriented npm package's root export into server-only code just because it happens to re-export a plain utility function you need — check whether the package ships a dedicated non-React subpath (`/core`, `/min`, etc.) or pull the underlying pure library directly instead.

---

## 2026-08-14 · Customer-import hardening: phone auto-detect, quoted CSV, concurrent org suggestions, resend-invite bulk action

Four follow-ups to the customer bulk-import feature (§17), each closing a gap found during review of that feature.

- **Phone: auto-detected, not strict-regex-or-reject.** The row schema no longer validates phone format at all — `lib/customer-import/phone-normalize.ts:normalizeImportPhone` parses any reasonably-formatted pasted value (with or without its own country code) against a caller-selected **default country** (a new `<Select>` in the wizard, defaulting to the geo-resolved country the rest of the app already uses via `CountryProvider`/`useDefaultCountry()`) and stores E.164. Previously a phone like `416-555-0123` — normal for a raw CRM export — failed strict E.164 validation and invalidated the **entire row**, not just the phone. An unparseable phone now just drops (phone stays optional everywhere else in this app) with a non-blocking `phoneWarning`, never blocking the person from importing.
- **CSV/TSV parsing respects quotes.** `lib/customer-import/parse-rows.ts:parseImportRows` (extracted from the wizard component into a pure, unit-tested module) is a real quote-aware line tokenizer — a comma inside `"Smith, John"` no longer splits the row when comma is also the delimiter. Handles `""` as an escaped literal quote too.
- **`suggestOrgCode` calls run concurrently.** `previewCustomerImport`'s per-unmatched-domain loop was fully sequential (one DB round-trip per distinct new-domain company, awaited one at a time) despite each call being independent — switched to `Promise.all`. Pure speedup, no behavior change (still doesn't dedupe suggested codes across domains within one run — that gap pre-dates this change and wasn't introduced or worsened by parallelizing it).
- **Invite-send failures are now trackable and bulk-actionable.** Nothing previously persisted "this invite email failed to send" anywhere queryable — it only existed transiently in an Inngest run's return value. `sendCustomerSetupInvite` (`lib/customer/invite.ts`) now retries the send once immediately (most failures here are a transient provider hiccup) and, on a still-failed second attempt, stamps a new nullable `users.invite_send_failed_at` column (migration `pnpm db:add-invite-send-failed`) — cleared the moment any later send succeeds. `computeInviteStatus` (`lib/users/invite-status.ts`) gained a 4th value, `invite_failed`, alongside the existing clock-derived `active`/`invited`/`invite_expired`. The admin Users list can now filter to it, and the External tab gets a checkbox column + a "Resend invite" bulk-action bar (`bulkResendCustomerInvites`, `app/actions/users.ts`) — deliberately implemented as a loop over the existing single-user `resetUserPassword`, not a reimplementation, so every permission check, role branch, and audit entry for a bulk resend is identical to a manual one. The same control also covers a customer who simply forgot their password (an `invited`/`invite_expired` row), not just a failed-send one — that was the actual ask, "failed to send" was just the state that was hardest to *find* without a stored flag.

---

## 2026-08-13 · Ticket-type sidebar icons are admin-chosen, not computed

The sidebar's ticket-type sub-nav (added earlier the same day) originally picked each type's icon by its position in a fixed 8-icon rotation (`i % 8`). That looked "dynamic" but wasn't relevant — it couldn't know that a type named "Onboarding" should get a different icon than "Network Outage," two types could collide on the same icon once there were more than 8, and reordering or deactivating one type silently changed everyone after it's icon for no reason.

- **Icon is now a real column** (`ticket_types.icon`, `lib/db/add-ticket-type-icon-column.ts`, idempotent — this repo's established pattern for single-column additions to an already-migrated table, not a numbered `drizzle-kit generate` migration), not a derived value. The curated vocabulary (30 keys) lives in `lib/tickets/type-icon-keys.ts`.
- **Admin picks it, pre-suggested by keyword.** `suggestTicketTypeIcon(label)` regex-matches the label ("incident" → alert-triangle, "billing" → credit-card, etc., generic `tag` fallback) to pre-fill a picker (`ticket-type-icon-picker.tsx`, a new `Popover`-based grid — see `components/ui/popover.tsx`, this repo's first vendored Popover wrapper) when creating a type. The admin can always override before saving. Renaming a type never re-suggests on top of an already-chosen icon — only an explicit repick changes it.
- **Why not full automation (keyword-only, no admin control)?** A type name is free text an admin invents; only they know what it's *for*. A bigger hardcoded label→icon table would still just be guessing, and — unlike the DB-backed choice — would be uncorrectable without a code change.
- **MCP parity**: `create_ticket_type`/`rename_ticket_type` (`lib/mcp/categories-types-write.ts`) accept an optional `icon` enum param; omitted, they fall back to the same keyword suggestion (no picker over MCP).
- **A React lint gotcha worth remembering**: binding a component reference produced by a *function call* to a variable, then rendering it as a JSX tag (`const Icon = resolve(x); <Icon/>`), trips `react-hooks/static-components`. Plain object/array indexing doesn't. `resolveTicketTypeIconKey` therefore returns a *key*, and every render site does `TICKET_TYPE_ICON_COMPONENTS[resolveTicketTypeIconKey(x)]` as one expression instead of stashing the resolved component in an intermediate variable.
- **A DDL gotcha, re-learned**: `add-ticket-type-icon-column.ts` first wrote `` sql`ALTER TABLE ... DEFAULT ${DEFAULT_TICKET_TYPE_ICON}` `` — the `${...}` interpolation becomes a bind parameter, and Neon's HTTP driver rejects a parameterized `DEFAULT` in an `ALTER TABLE` (`bind message supplies 1 parameters, but prepared statement requires 0`). `add-ticket-types.ts` had already hit and fixed this exact issue for `tickets.type`'s default by inlining the literal (`DEFAULT 'service_request'`) straight into the SQL text — the icon script now does the same via `sql.raw()`. Rule of thumb for every future `db/add-*-column.ts` script: a `DEFAULT` value in raw DDL must be a literal in the string, never a `${}` interpolation.

---

## 2026-08-08 · MCP write-tool surface + `mcp.connect` permission

The MCP connector (§23 of the README) launched with 8 read tools and one internal-note write tool. In the same feature arc it grew to ~53 tools total: 43 more write tools across tickets, users, roles, organizations, procurement, settings, and taxonomies (mirroring almost every mutating Server Action in the admin panel), plus one more read tool (`summarize_audit_log`). That's a big enough surface-area jump to need principles written down, not just discovered by reading eight new files.

- **New gating permission, not a scope widener.** `mcp.connect` controls who can mint a Bearer token for themselves at all (self-service from `/admin/profile`) — it does NOT change what a token can do once minted, since every tool call still re-runs `can()`. Seeded by default to Super Admin, IT Director, Coordinator; Technician and Customer don't get it. Backfilled onto already-seeded databases via migration `0031` / `pnpm db:add-mcp-connect-permission`, since `pnpm db:seed` no-ops once roles exist (same pattern as `audit.view`'s default-grant backfill in migration `0015`).
- **`resolveMcpToken` re-checks `mcp.connect` on every request**, not just at mint time — demote someone out of an eligible role and their existing token stops working on the very next call, no separate revocation step needed.
- **Every write tool is a mirror, not a new code path.** Each `lib/mcp/*-write.ts` `*ViaMcp` function is ported from the Server Action it's named after (verbatim `can()` checks, business-rule guards, audit rows, and notification side effects), adapted only to (a) take an explicit `SessionUser` since there's no cookie/`headers()` context over a Bearer token, and (b) resolve things by email/name/ticket-number instead of uuid, since that's what a chat conversation naturally supplies. Shared pieces (`permissionsBeyondCaller` in `lib/auth/permission-diff.ts`, the organization-validation helpers in `lib/organizations/validation.ts`) were extracted out of their `"use server"` action files specifically so the mirror can't drift from the original.
- **MCP can do LESS than the UI, never more — enforced by refusal, not omission.** The browser-only reauth-sensitive actions that are deliberately refused over MCP are granting/keeping Super Admin and any `settings.update` write. Rather than silently skip those tools, `create_user`/`update_user` refuse a Super-Admin grant with a message pointing at the admin panel, and `update_setting` exists as a tool that always explains why it can't do anything and where to go instead — so an agent asking "can you turn off X setting" gets a clear no, not a missing tool it might not think to ask about. `deactivate_user` and `reset_user_password` stay available to MCP as ordinary permissioned actions because the current server-action implementation does not add a separate browser-only reauth gate there.
- **Confirm-before-send is a prompt convention, not a protocol.** Since there's no second-step UI dialog the way the admin panel has, every mutating tool's description ends with an explicit instruction to show the user the exact change and get their go-ahead in chat before calling it — strongest on `reply_to_ticket` (customer-visible) and `resolve_ticket`.
- **Known gap:** `tickets.close`/`closeTicket` (added two days earlier, see the entry below) has no MCP tool yet — `tickets-write.ts` predates it.

---

## 2026-08-06 · Staff-initiated ticket close (`tickets.close`)

Previously a ticket could only reach `closed` via the customer's CSAT rating, the 24h auto-close cron, or as a merge side-effect — no staff member had a manual close button. Coordinator, IT Director, and Super Admin needed one; Technician and Customer explicitly should not get it.

- **New standalone permission, not folded into `tickets.resolve`.** `tickets.close` is its own permission so a role can be granted one without the other — IT Director gets `tickets.close` despite never having held `tickets.resolve` (it doesn't resolve tickets itself, but the client wanted it able to close them). Granted by default to Coordinator, IT Director, and Super Admin only.
- **Source-status guard: only from `resolved`.** `closeTicket` rejects any other current status, mirroring exactly what the CSAT/auto-close paths already require — one consistent lifecycle rule (`resolved → closed`) everywhere, rather than letting staff skip straight from `open`/`in_progress` to `closed`.
- **Scope:** slotted into the same `can()` case block as `resolve`/`reopen`/`escalate` — a strict Technician can't have it anyway (permission isn't granted), and elevated roles already see every ticket, so this is defensive consistency more than new logic.
- **Notifications reuse the existing close plumbing verbatim.** Customer gets the same `ticket_closed` dispatch (authenticated → `notification/dispatch`; guest → direct email) that CSAT/auto-close use, with a new `reason: "staff"` branch. Staff oversight reuses `dispatchTicketClosedStaff` (also extended with `reason: "staff"`) to Coordinator/IT Director/Super Admin — including the actor's own role, matching the project's existing no-self-exclusion convention for role-broadcast notifications (e.g. `ticket.reassigned`).
- **UI:** a "Close ticket" button sits next to Reopen in the same actions card once a ticket is `resolved` — no separate note/reason modal, matching Reopen's plain-button pattern rather than Resolve's note-modal pattern (closing needs no input).

---

## 2026-06-02 · Meeting-2 revisions — Organizations, work logs, billing, procurement rework, role/numbering/branding changes

Implementation of the client's Meeting-2 (2026-05-22) change requests. Source + a sequenced change list live in `docs/meeting-2-revisions-2026-05-22/`. Migrations `0008`–`0010`. Highlights and the non-obvious calls:

- **Organizations registry (CR-06)** — new `organizations` table (name, unique `abbreviation` 2–5 alnum, `is_monthly_plan`, `monthly_minutes_included/balance`, contract notes). Hours are stored as **integer minutes**, not fractional hours, so the Monthly-Plan deduction is exact. `users.organization_id` + `tickets.organization_id` (both nullable FKs; the users FK is hand-written in `0008` to avoid a schema import cycle). New `organizations.*` permission domain (back-filled to seeded roles in the migration). Full admin CRUD under `/admin/organizations`.

- **Ticket numbering `ORG-YYYYMMDD-NNN` (CR-07)** — replaced the `AX-####` generator with `generate_ticket_number(prefix, tz)` backed by an atomic per-(prefix, day) `ticket_number_counters` table. The prefix is the matched org's abbreviation (or a 2-letter fallback derived from a typed name, else `AX`); the date uses the business timezone. The number is generated once and stored, so a reply never spawns a new ticket — and for the guest draft-with-attachment path it is **regenerated at promotion** (the org isn't known at draft time). The inbound-email extractor now matches both the legacy and new formats.

- **Statuses + escalation (CR-13/14)** — added `awaiting_customer_confirmation` and `escalation` to the status CHECK. `awaiting_customer_confirmation` is a real status a tech sets via `setTicketStatus` (shown to the customer as "Awaiting customer"). **Escalation stays a flag** (`is_escalated`), NOT a status — the boss said "*flag* it as escalation," and a status would leak the internal escalation into the customer's status view. Escalation now also captures `escalation_target_role` (which upper-hierarchy role it went to) and routes the notification there.

- **Completion time (CR-15)** — computed on read as `closedAt − createdAt`; no stored column.

- **Work log + Monthly-Plan deduction (CR-12/19)** — new `work_logs` table (description, integer `minutes`, on-site/remote, auto timestamp), UI above the conversation. Deduction is **idempotent**: `tickets.monthly_plan_deducted_minutes` tracks how much a ticket has already taken from its org's balance, and `syncMonthlyPlanDeduction(tx, ticketId)` only ever applies the delta — safe + reversible when logs change or `billable` toggles.

- **Billable (CR-16/17/18)** — `tickets.billable` (yes/no/monthly_plan/project/**rework** — Rework included per the client's answer), set **per ticket** by anyone with `tickets.update` (the boss's "everyone for now").

- **Technician collaboration (CR-08/09/10/11)** — Reply composer split into two cards ("Reply to Customer" + "Internal Notes") via a `mode` prop. Technicians can directly reassign their own ticket: `tickets.assign` added to the ticket-scoped `can()` group (strict tech → own ticket only) and granted to the Technician role. Multi-tech assignment uses a `ticket_assignees` junction (primary assignee stays on `tickets.assigned_to_id`); collaborators get ticket access via an extended `can()` ticket target (`assigneeIds`) + an `EXISTS` clause in `ticketsVisibilityCondition`.

- **Procurement rework (CR-20..26)** — approval workflow removed entirely. `type` gains `other`; `urgency` and all approval/purchase/deliver columns dropped (`0010` remaps existing rows to the new stages before the new CHECK applies). Four single-select stages: `awaiting_customer_payment → order_pending → order_placed → order_completed`. The 4 old permissions collapse into one `procurement.manage`. Who/when moved a stage lives in the **audit log**, not columns on the row (this also let the destructive migration generate without an interactive rename prompt).

- **Roles + language + branding (CR-27/28/29)** — Super Admin can edit **system-role permissions** (others still can't; system-role deletion stays blocked for all). The **Language field** is removed from every form/action; the `users.language` column is kept (defaults `en`) as the forward i18n placeholder the email layer reads. Brand confirmed as **"Axiom360"** (the transcript's "Axium" was a mishearing — every written artifact uses "Axiom"); fixed the bare-"Axiom" strings to the full name (the wordmark already composes `brandName "Axiom" + accent "360"`).

- **Customer forms** — mandatory Organization field on the guest submit + sign-up forms; Category removed from customer forms (defaults to `other` server-side, kept for staff); file-size limit shown in MB.

Pre-existing test note: `can.test.ts` has 2 failing cases on Super-Admin `users.update` self/hierarchy that predate this work and contradict `can.ts`'s own deliberate behavior — left untouched.

---

## 2026-05-21 · CSAT-unsatisfied captures customer comment + notifies tech & Coordinator; email links route by account state

Three issues surfaced once customers actually used the CSAT prompt in production. All three close together because they share the same flow (resolution → customer pushes back → ticket reopens).

- **"No, still not fixed" now takes a comment.** Previously the portal's CSAT prompt fired immediately on the No button, so the ticket reopened with no signal beyond "reopen count went up." Two-stage UI now: clicking No reveals a textarea (`portal.tickets.csat.commentLabel`, 2000-char cap) with Reopen + Cancel buttons. On submit, `submitCsatFromPortal(ticketId, "unsatisfied", comment)` wraps the status update + message insert in a single `transactional` so the comment lands on the thread as an authored `messages` row (`authorType: "customer"`, `bodyFormat: "text"`, `channel: "portal"`) — the assigned tech now sees the customer's words in context, not just a status flip. Comment is optional; empty submissions still work for users who can't articulate the problem.

- **Email "view your ticket" links now route by account state.** When the ticket has a `customer_id` (registered customer), outbound email buttons go to `/portal/tickets/<num>` (authenticated portal); when null (guest), they go to the existing HMAC-signed `/portal/guest/tickets/<num>?token=...` URL. Implemented once in `lib/tokens.ts:ticketTrackingUrl({appUrl, ticketNumber, customerEmail, customerId})` so every email producer (`assignTicket`, `replyToTicket`, `resolveTicket`, `reopenTicket`, `/csat/confirm` route handler, `process-inbound-email`) picks the right URL without duplicating the if-else. Old `guestTicketUrl` remains for the two paths where customer linkage isn't known at send time (`createTicket`, `createTicketOnBehalf`).

- **New `ticket.csat_unsatisfied` dispatch event for staff.** When a customer reopens via CSAT (portal button OR email link), we now fan out a notification to the assigned tech + every active Coordinator through `notification/dispatch`. Honors each recipient's email/SMS/bell prefs (added the event to `KNOWN_EVENT_TYPES` so it shows up in their preference page; defaults email + SMS both on per the schema). Dispatched from both entry points (`submitCsatFromPortal` and `/csat/confirm`) so the team is notified regardless of which CSAT surface the customer used. The previous email-link path had a half-baked direct `sendEmail` to the tech only with the wrong template (`new_assignment`); that's removed in favor of the dispatched event + dedicated `csat_unsatisfied_staff` email template. Stack additions: event in `NotificationEventType`, descriptor in `registry.ts`, SMS template in `sms-types.ts` + `sms.csatUnsatisfiedStaff` namespace, email template `csat-unsatisfied-staff.tsx` + `emails.csatUnsatisfiedStaff` namespace, in-app i18n under `notifications.ticket.csat_unsatisfied`.

---

## 2026-05-21 · Every customer-facing ticket update fans out through dispatch (email + SMS + bell)

Yesterday's pass added `ticket.resolved` to the dispatcher but left assigned / agent-replied / reopened / closed as direct `sendEmail` calls — meaning the customer's SMS toggle and bell icon were dead for those events. This change closes the whole class.

**Customer-facing events now fully dispatched** (each fans email + SMS + in-app through `notification/dispatch`, honoring per-event `notification_preferences`):

- `ticket.assigned` — `assignTicket` fires a second dispatch (the first is for the tech) targeting `recipientUserIds: [ticket.customerId]` with the existing `ticket_assigned` email template + new `ticket_assigned_customer` SMS template.
- `ticket.agent_replied` (NEW) — `replyToTicket` dispatches this with the existing `ticket_reply` email template + new `agent_replied` SMS template.
- `ticket.resolved` — done yesterday; unchanged today.
- `ticket.reopened` (NEW) — `reopenTicket` dispatches with the existing `ticket_reopened` email template + new `ticket_reopened` SMS template.
- `ticket.closed` (NEW) — `auto-close-resolved` cron dispatches with the existing `ticket_closed` email template + new `ticket_closed` SMS template. CSAT-driven closure (customer clicked "Satisfied") doesn't dispatch — the customer just clicked the button, no notification needed.

**Guest tickets** (no `customer_id`) still take the direct `sendEmail` path on every event. They have no preferences row, no SMS phone, and no in-app inbox; falling back to email is the only signal we have. Inlined as `if (customerId) dispatch else sendEmail` blocks at each site so the guest path stays a single hop.

**Customer notification preferences UI** now lists five events: assigned / agent-replied / resolved / reopened / closed. Removed `ticket.customer_replied` from the customer's view — that event fires when the CUSTOMER replies and goes to AGENTS, so the toggle never applied to the customer's own inbox in the first place. Stranded pref rows (if any) under that key are left in place; they default to on/on, which matches the historical behavior, so nothing breaks for users who were toggling that field.

**SMS template overload avoided.** Staff and customer events share names where intent matches (`ticket_assigned` for tech vs `ticket_assigned_customer` for customer) but use distinct template keys so each side's wording can differ — tech links into `/admin/tickets/<id>`, customer links into `/portal/tickets/<number>`.

---

## 2026-05-21 · Ticket-resolved notification fan-out + in-portal CSAT

Two adjacent gaps surfaced in production testing — the customer never got an SMS when their ticket was resolved, and the only way to give CSAT feedback was clicking the buttons in the resolution email. Both are now closed.

- **`ticket.resolved` is a real dispatch event.** Added to `NotificationEventType`, the in-app registry, the SMS template union, and the SMS i18n namespace. `resolveTicket` no longer calls `sendEmail` directly for authenticated customers — it fans out through `notification/dispatch`, which honors the customer's per-event email+SMS preferences AND inserts a bell-icon row. Guest tickets (no `customer_id`) still take the direct-email fallback because they have no preferences row, no SMS phone, no in-app inbox. Closes the gap flagged in `DECISIONS.md` 2026-05-10's "customer notification preferences ship with `ticket.assigned` and `ticket.customer_replied` only — `ticket.resolved` is held back."

- **CSAT is now available from the portal, not just the email.** New `submitCsatFromPortal(ticketId, response)` server action mirrors the logic of the existing `/csat/confirm` route handler, but doesn't need a signed token — the authenticated session is the proof of ownership (`tickets.customer_id === user.id`). Idempotent: refuses on already-responded tickets, refuses if the ticket isn't in `resolved` status. On `satisfied` → `status: closed`. On `unsatisfied` → reopen (`in_progress` if still assigned, else `open`) + bump `reopened_count` + dispatch a `ticket.customer_replied` so the assigned tech sees the bell ping. Audit row tags `source: portal` so the audit log can distinguish portal feedback from email-link feedback.

- **`<CustomerCsatPrompt>` UI component.** Lives on the customer ticket-detail page. Renders when `status === "resolved"` AND `csatResponse IS NULL` — two buttons (Yes / No). When the customer has already responded, renders a small recap banner instead ("Marked as resolved" / "Reopened for the team"). Keeps the page coherent regardless of whether the customer's coming back to view it after their click.

- **`csatResponse` plumbed onto `CustomerTicket`.** `lib/customer/queries.ts:getMyTicketByNumber` + `getGuestTicket` now project `csat_response`. The prompt component needs it to decide between prompt-mode and recap-mode.

---

## 2026-05-21 · Customers don't pick ticket priority

The customer-facing ticket forms (anonymous `/portal/submit` and authenticated `/portal/tickets/new`) used to require the submitter to choose a priority — `low / medium / high / critical`. Two production failures of that design (independent of our codebase, observed across the industry):

1. **Priority inflation.** Every customer thinks their issue is the most important one. Within weeks "everything is critical." The categorical meaning collapses; the team can't actually triage.
2. **Vested-interest field.** The submitter has an obvious incentive to mark their own issue high. Asking them is asking the wrong person.

Zendesk, Jira Service Management, Freshdesk all hide priority from customers on the standard form for the same reasons.

**New flow:**

- Both customer-facing forms drop the priority dropdown entirely.
- Server schemas (`createTicketSchema` in `tickets.ts`, `customerCreateSchema` in `customer-portal.ts`) now have `priority: z.enum(TICKET_PRIORITIES).optional().default("medium")`. Tickets that omit priority land at `medium` — a reasonable SLA bucket.
- Caller-facing types are `z.input<typeof schema>` not `z.infer<>`, so `priority` is properly optional on the action's input but always defined on `parsed.data` inside the action body.
- **`createTicketOnBehalf` (staff creating a ticket for a customer) keeps the priority field.** Staff have the context to set it correctly, and that's a different flow.
- **Inbound-email tickets** were already defaulting to `medium` (see `DEFAULT_INBOUND_PRIORITY` in `process-inbound-email.ts`) — consistent.
- When the Coordinator later changes priority on a ticket, `recomputeSlaForTicket` re-stamps the due-time columns. That code path already existed; this change just makes it the primary mechanism for priority assignment.

**What this does NOT do:** doesn't remove "Urgency" as a concept. If we ever want a softer urgency input from customers (a 3-level "Low / Normal / High" picker that maps to priority but doesn't pretend to BE priority), we can add it later. For now the subject + description carries the urgency signal — a coordinator reading "Production database is down" doesn't need a dropdown to know it's critical.

---

## 2026-05-21 · Phone field uses `react-phone-number-input` (country picker)

Plain `<input type="tel">` accepted E.164 but didn't help users enter it — anyone typing `416-555-0123` got a validation error with no guidance. Swapped for `react-phone-number-input` across all four phone surfaces (customer sign-up, customer profile, admin user-create, admin profile).

- **What the library gives us:** country dropdown with flag + name, search-by-country, auto-prepends the calling code, formats the digits visually as you type (`(416) 555-0123`), stores E.164 internally (`+14165550123`), validates per-country length/format via libphonenumber-js. About 30 KB gzipped including libphonenumber's metadata (tree-shakable down if we ever lock to specific regions).
- **Default country is `PK`.** Matches the current deployment. Customers in other regions change the dropdown; the library remembers within the session.
- **CSS lives in `src/app/globals.css`.** Imported the library's base styles once at the app level, then layered overrides on the `.PhoneInput*` classes so the field matches our other form inputs (rounded-md, ≥42px height for tap targets, focus ring in `blue-500`, dark-mode background). Avoided per-component imports so the CSS bundle isn't duplicated.
- **Server-side validation unchanged.** The action-layer zod regex (`^(\+?[1-9]\d{1,14})?$`) still runs as defense-in-depth — the library produces E.164 strings, which match. If someone bypasses the client and submits a malformed string, the server still rejects.
- **`value || undefined` on the way in, `v ?? ""` on the way out.** The library expects `undefined` for empty (it's how it knows to show the placeholder), but our state holds an empty string for consistency with the rest of the form. Two-line conversion in each onChange handler.

---

## 2026-05-21 · Phone collection wired end-to-end; customer portal shell elevated (sidebar + dashboard + bell + ticket-list filters)

The product surface for customers was sparse — a topbar with two links, a flat ticket list, decorative SMS toggles that did nothing. This change closes that gap.

- **Phone is now a real field, not a phantom column.** `users.phone` has existed since M1 but no UI ever collected it, so every SMS toggle was dead. Phone is now an optional input on (1) the customer sign-up form, (2) the customer profile, (3) the admin user-create form, (4) the admin profile. All four validate as E.164 (`+<digits>`) or empty (cleared → null in DB). Sign-up routes phone through Better Auth's `additionalFields` config (added `phone: { type: "string", required: false }` to `lib/auth/index.ts`) so the magic-link verification stores it on the freshly-created `users` row. Existing dispatch logic — `if (data.sms && smsOn && r.phone)` in `dispatch-notification.ts` — was already correct; we just needed real phone values to flow into it.

- **Customer portal sidebar + dashboard.** `/portal/(authenticated)/layout.tsx` now mirrors the admin shell: a `<CustomerSidebar>` slate-900 panel on `lg+` with Home / My Tickets / Profile + a prominent "+ New ticket" CTA, plus the existing topbar with a notifications bell. Below `lg` the sidebar hides and the topbar's mobile-only second-row nav takes over — same responsive pattern as admin. A new `/portal/page.tsx` is the default landing: three stat cards (Open / In progress / Resolved, each linking into a pre-filtered ticket list) and a "Recent tickets" list (5 most-recently-updated).

- **Notifications bell on the customer side.** The existing `<NotificationBell>` (admin) is portable by design — accepts initial server-fetched payload, polls every 30s, marks-read/all-read actions, dropdown UI. Dropped it into the customer topbar with `getRecentNotifications()` for the initial state. The dispatcher already inserts in-app rows for `ticket.assigned` and `ticket.customer_replied` against customers (per the existing notification preferences), so customers immediately see relevant activity in the bell.

- **Ticket list filters + search.** `/portal/tickets` got four status chips (`All / Open / In progress / Resolved` — where Resolved combines `resolved` + `closed`) and a search input that matches against subject + ticket number. Both are URL-driven (`?status=…&q=…`) — no client state, bookmarkable, the dashboard's stat cards link directly into pre-filtered views (e.g. `/portal/tickets?status=resolved,closed`).

- **What we deliberately didn't do:** no help/knowledge-base section (no content yet — would be empty), no per-ticket notification settings (the existing per-event-type prefs cover it), no mobile drawer for the sidebar (the existing mobile second-row nav strip already covers nav reachability; building a drawer is extra surface without proportional value).

---

## 2026-05-21 · Sanitizer swap (isomorphic-dompurify → sanitize-html); sign-in cookie-prefix fix; sign-in is existing-accounts-only

Three changes ship together. Common thread: every fix here was forced by production runtime behavior that doesn't show up in dev or in tests.

- **`isomorphic-dompurify` is gone; `sanitize-html` is in.** A late-2025 dependency tree shift caused `html-encoding-sniffer@6` to `require()` an ESM-only `@exodus/bytes/encoding-lite.js`, which Vercel's Node 24 runtime under Next 16 / Turbopack can't resolve synchronously. Every server action that loaded `lib/messages/sanitize.ts` — including the sign-in path via `customer-portal.ts` — crashed at module load with `ERR_REQUIRE_ESM`. The user couldn't sign in. `sanitize-html` is pure CommonJS, purpose-built for server-side HTML sanitization, no DOM polyfill, no jsdom. Same security guarantees: allowlist of tags, allowlist of attributes, restricted URL schemes, every `<a>` rewritten to `target="_blank" rel="noopener noreferrer"`. The `transformTags` API is cleaner than DOMPurify's `ADD_ATTR` + regex post-processing we had before.

- **Proxy now checks both session-cookie names.** Better Auth promotes its session cookie to the `__Secure-` prefix over HTTPS (browser security convention — `__Secure-` cookies can only be set over TLS). The proxy was only looking for `better-auth.session_token`, missing the prefixed version in production. After a successful magic-link verification, the proxy saw "no cookie" and redirected the freshly-signed-in user back to `/portal/sign-in?from=/portal/tickets`. Helper `hasBetterAuthSessionCookie(req)` checks both names; the proxy never validates the value (the layout does that), so accepting either name is enough.

- **Sign-in is existing-accounts-only.** Previously `requestMagicLink` passed `newUserCallbackURL`, so Better Auth auto-created accounts on first magic-link click for unknown emails. That meant users who took the "shortcut" of entering email on the sign-in page (skipping `/portal/sign-up`) ended up with nameless accounts (the sign-in form has no name field). Hard for agents to triage "(no name) opened a ticket." New rule: sign-in performs a user-existence check before issuing the magic link; unknown emails get `account_not_found`, surfaced as a friendly "Use Create one below" message in the form. New users MUST go through `/portal/sign-up`, where the name is captured. Trade-off: minor email enumeration risk (an attacker can probe which addresses exist), acceptable for an internal IT ticketing tool. Rate limits (10/IP/hr, 3/email/hr) keep probing slow.

---

## 2026-05-22 · Admin user-create direct insert; setup-invite auto-sign-in; sidebar permission gating; hierarchy filter; matrix native `<details>`

A bundle of corrections after the system was used end-to-end in production. Common thread: every fix here closes a gap that wasn't obvious from reading the code alone — only from operating it.

- **`createUser` bypasses `auth.api.signUpEmail` entirely.** The previous fix (capture the admin's `better-auth.session_token` cookie and restore it after signUpEmail) failed in production. The reason is environment-dependent cookie naming: Better Auth promotes the cookie to the `__Secure-` prefix over HTTPS, so a hardcoded `"better-auth.session_token"` lookup misses the actual cookie value and the admin still ends up signed in as the new user. New approach: don't fight Better Auth's session-issuing behavior — sidestep it. Insert the `users` + `accounts` rows directly via Drizzle inside a single `transactional`, with `accounts.providerId = "credential"`, `accounts.accountId = <newUserId>`, `accounts.password = null`. The user has no way to authenticate via credential until they click the setup-invite link, which routes through `auth.api.resetPassword` and stamps a real hash on the `accounts.password` column. Better Auth never issues a session for the new user because no Better Auth sign-up endpoint is called. The admin's session cookie is never touched. The whole class of "what does the cookie name happen to be today" bugs is gone.

- **Setup form auto-signs-in on success.** Previously, clicking "Set my password" called `auth.api.resetPassword` and redirected to `/admin/login?reset=ok` — the user then had to type their brand-new password a second time to reach `/admin`. To users this looked like a broken first-click; they assumed the first submit didn't take. Fix: the setup-invite URL now carries `&email=<email>` alongside the token (see `lib/auth/index.ts:sendResetPassword`). The `setupPassword` server action signs the user in via `auth.api.signInEmail` immediately after the reset succeeds, returning `{ ok: true, signedIn: true }` on success. The client redirects to `/admin` on `signedIn: true` and to `/admin/login?reset=ok` only when the auto-sign-in fails (rare — e.g., account already locked). The setup form ALSO keeps `submitting=true` past navigation so a fast double-clicker can't fire a second submit against a now-consumed token.

- **Sidebar links gated per-permission.** Each `NavItem` in `components/shared/sidebar.tsx` declares its `requires: Permission`. The gated layout passes the caller's permission array; the sidebar filters before rendering. A Coordinator who lacks `roles.view`, `settings.view`, `audit.view` no longer sees those nav entries. Keeps the sidebar honest with the page-level redirects that gate the destinations themselves — if you can see the link, you can reach the page.

- **Hierarchy excludes non-creator users.** `/admin/hierarchy` previously showed every user, including Customers and Technicians who can't themselves create children. The hierarchy is meant to visualize the creator chain, so its contents should match its purpose. New query adds a correlated `EXISTS` subquery on `user_roles` → `role_permissions` requiring at least one of (`users.create`, `roles.create`). Filtered users are dropped from the tree entirely; if a filtered user had a creator-eligible parent, the surviving subtree just doesn't include them.

- **Permissions matrix uses native `<details>`/`<summary>`.** The previous `useState<Record<string, boolean>>` accordion was reported as not expanding for some users — likely a React Compiler memoization or stale closure issue, though we never pinned the exact cause. Native `<details>` lets the browser own the open/closed bit; chevron rotation is driven by `group-open/details:rotate-90` on the icon. The "Select all" toggle moved OUT of `<summary>` into the body so clicks on it don't route through the browser's open/close handling. Whole class of state-stuck bugs gone. **Follow-up the same day:** the body was rendering empty for read-only callers (system roles, non-editor viewers) because `isLocked()` returns true for every permission in read-only mode and `visiblePerms` was computed as `showingLocked ? perms : grantable` — i.e., it filtered to *grantable* perms only. In read-only mode `grantable` is always empty, so the accordion expanded onto a blank `<ul>`. Fix: in read-only mode `visiblePerms` is unconditionally `perms` (everything), rendered as disabled checkboxes. The "Show locked" footer is still hidden in read-only mode since the whole role is read-only and the lock badge per row would be noise.

- **Hierarchy filter: "non-Customer roles" beats "creator permissions".** First attempt used `EXISTS (… WHERE permission IN ('users.create', 'roles.create'))`, but in the seeded defaults only Super Admin holds either permission. That collapsed the tree to a single node — every IT Director, Coordinator, and Technician that Super Admin created was filtered out. Correct rule is broader: include any user with at least one role other than `Customer`. Pure-Customer accounts (self-registered portal users) still don't belong in the staff org chart, but Technicians/Coordinators/IT Directors do — they ARE the descendants the chart exists to show. Custom roles work automatically: anything not literally named `Customer` qualifies.

- **Role View modal renders human-friendly labels.** `RoleRowActions`'s "View" dialog previously rendered raw permission strings (`tickets.view`) in `<code>` chips. Now it reuses the same `roles.matrix.label.<key>` i18n namespace as the permissions matrix → renders "View tickets" in friendly pill chips. Same source of truth for the labels means there's one place to update if a permission gets renamed.

---

## 2026-05-21 · Ticket stream classification, admin user-create session safety, setup-page proxy exemption

Three changes ship together. Common thread: each closes a quiet failure mode that only surfaced once the system was used end-to-end in production.

- **Role beats domain for `stream`.** Previously every ticket-creation path (`createTicket`, `createTicketOnBehalf`, `customerCreateTicket`, the inbound-email processor) decided "internal vs external" purely by checking the submitter's email domain against the `internal_email_domains` setting. That failed for staff with personal email addresses (Technician on a gmail account → tickets misclassified as external) and for staff who self-onboarded via the portal first. New rule, implemented once in `src/lib/tickets/stream.ts:classifyStream(email)`: if the email maps to an active user holding ANY staff role (Super Admin / IT Director / Coordinator / Technician), the ticket is internal regardless of domain. Otherwise the `internal_email_domains` allowlist applies. Every creation path now delegates to that helper so the rule has a single source of truth. Industry-aligned with how Jira Service Management and Zendesk classify requesters: account/role wins; domain is the unauthenticated fallback.

- **`createUser` must not steal the admin's session.** Admin-creating-a-user routes through `auth.api.signUpEmail` (Better Auth's standard sign-up endpoint). Better Auth always issues a session for the freshly-created user, and our `nextCookies()` plugin stamps that session token into the response cookie jar — silently signing the calling admin OUT of their own session and IN as the new user. The browser holds one cookie; first one to write wins. Fix in `src/app/actions/users.ts:createUser`: capture the admin's `better-auth.session_token` cookie value BEFORE `signUpEmail` runs, restore it immediately after, AND delete the new user's auto-issued `sessions` row so a leaked cookie value can't validate. The new user reaches their first real session via the setup-invite email flow as intended.

- **`/admin/setup` exempted from the edge proxy.** `src/proxy.ts` gates all of `/admin/*` behind the `better-auth.session_token` cookie, except `/admin/login`. `/admin/setup` was being caught by that gate, but it's where the setup-invite email link lands — the user pressing the button has no account yet and CAN'T have a session. The redirect to `/admin/login?from=/admin/setup` produced a circular dead end (they can't log in either; that's the entire point of the page they were trying to reach). The proxy now allowlists both `/admin/login` AND `/admin/setup`. The setup page itself remains safe — it has no logic of its own; the token is verified by `auth.api.resetPassword` at submit time, which rejects anything tampered with.

---

## 2026-05-10 · Customer portal

**Decision:** ship a customer-facing portal under `src/app/(public)/portal/(authenticated)/*` with magic-link primary auth (Better Auth `magicLink` plugin) and password fallback for impatient users. The plumbing (Customer role, `CUSTOMER_PERMISSIONS`, `isStrictCustomer`, `customerVisibleMessages`) was already in the codebase but unwired — the portal connects it.

**Key choices:**

- **Magic link primary, password fallback.** Magic link removes password-reset support load and uses the existing `verifications` table. Password remains for users who want it, behind a "use a password instead" toggle.
- **Identity reconciliation runs inside Better Auth's `databaseHooks.user.create.after`** — atomically claims every `tickets.customer_id IS NULL` row whose `customer_email` matches the verified email, audits the count. Idempotent (`WHERE customer_id IS NULL`) so re-runs are no-ops. The same UPDATE backs `pnpm db:backfill-customers` for legacy bulk migration.
- **Single route group `/portal/(authenticated)/*`** under the existing public layout — reuses the skip-link + `<main id="main-content">` landmark; avoids duplicating a third chrome.
- **Server-side role gate in the portal layout** redirects `!user.roleNames.has("Customer")` to `/admin`. Combined with the proxy cookie pre-check, customers and admins can't accidentally cross into each other's surfaces even with a shared session cookie.
- **Customer-channel writes are *not* the agent reply path.** `customerReply` and `customerCreateTicket` live in `src/app/actions/customer-portal.ts`. They mirror the agent flow's shape but always set `authorType: "customer"`, `channel: "portal"`, and dispatch the `ticket.customer_replied` notification to the *assigned tech* — never to the customer themselves.
- **Internal-note attachments are doubly guarded.** The new check in `getDownloadUrl` blocks `isStrictCustomer(user)` from downloading attachments whose parent message has `is_internal_note = true`, even on a ticket they own. The permission gate alone wasn't enough.
- **Stricter rate limits for portal auth than admin.** Magic link: 3/email/hour, 10/IP/hour. Customer ticket creation: 5/user/day. Customer reply reuses the existing `authReply` (200/h) bucket.
- **Customer notification preferences ship with `ticket.assigned` and `ticket.customer_replied` only** — `ticket.resolved` is held back until F-best-practices-3 (audit plan) routes the resolved-email through Inngest dispatch instead of the current direct `sendEmail` call.

---

## 2026-05-08 · Accessibility (M14.5)

**Decision:** Target WCAG 2.1 AA. Enforce in three layers — eslint-plugin-jsx-a11y at lint time, @axe-core/playwright at e2e time, and human review for screen-reader / contrast / keyboard walkthroughs (see README's "Accessibility" section).

**Notes / deviations:**

- **`color-contrast` rule is disabled in CI** — axe's contrast check flickers under CI's dark-mode media-query handling. Re-enable when the design system locks in tokens. Manual contrast audit is on the M14.5 carryover list.
- **Skip-link** is rendered in both the admin gated layout and the public layout. It targets `#main-content`, which is the `<main>` wrapper in each.
- **Permissions matrix and hierarchy tree** are flagged in the spec for explicit screen-reader testing. The matrix uses native `<input type="checkbox">` + associated `<label>`; the tree is a recursive `<ul><li>` with `<a>` rows. Both are intentionally markup-driven (not custom widgets) so a screen reader announces them as standard form / list controls without extra ARIA.
- **`<th scope="col">`** is the default in the shared `Table` component — every column header in the project's data tables is a column header, so we apply it once at the primitive layer rather than per call site.

---
