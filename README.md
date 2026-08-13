# Axiom360 Ticketing System

Internal IT ticketing platform for Axiom360. Built on **Next.js 16 (App Router) + React 19**, **Postgres (Neon) + Drizzle ORM**, **Better Auth**, **Inngest**, **Resend**, **Twilio**, and **Cloudflare R2**. Designed for an in-house IT team to triage tickets, assign technicians, run a multi-step procurement workflow, enforce SLAs, and give customers a clean self-service surface.

> **Synchronization rule:** any code change in this repository must be mirrored here. This README is the canonical description of how the system behaves; if the code drifts from it, update this file in the same change.

> **Heads-up for AI coding agents:** Next.js 16 introduced breaking changes to APIs, conventions, and file layout. Before writing or refactoring Next-specific code, read the relevant guide in `node_modules/next/dist/docs/`. Heed deprecation notices.

---

## 1. Stack at a glance

| Concern | Choice |
|---|---|
| Runtime | Node ≥ 24, pnpm 10 |
| Framework | Next.js 16.2 (App Router, React Compiler enabled, RSC-first) |
| UI | React 19, Tailwind 4, shadcn/ui (style `base-nova`), Base UI, lucide-react, tw-animate-css |
| Editor | TipTap 3 (`@tiptap/starter-kit` + link extension); sanitized server-side with `sanitize-html` (pure CommonJS — no jsdom dependency) |
| Forms | react-hook-form + zod via `@hookform/resolvers`; phone fields use `react-phone-number-input` (country picker with flags, auto-formats E.164, validates per country via libphonenumber-js, default country `PK` — see `src/app/globals.css` for the Tailwind theme overrides) |
| Charts | recharts 3 |
| Export | `exceljs` (XLSX) + `pdfkit` (PDF) behind a shared `lib/export/` dispatcher; CSV is hand-rolled |
| AI agent access | `@modelcontextprotocol/sdk` — a Bearer-token-authenticated MCP server exposing 50+ tools spanning tickets, users, roles, organizations, procurement, settings, and taxonomies (read tools + a write surface mirroring most Server Actions, see §23) |
| ORM / DB | Drizzle ORM 0.45 against Neon Postgres (HTTP driver for reads/single-statement writes; WebSocket Pool for transactions) |
| Auth | Better Auth 1.6 (email/password + `magicLink` plugin + passkeys table prepared) |
| Background jobs | Inngest 4 (one `/api/inngest` handler exposes every function) |
| Email | Resend (`@react-email/components` for templates, Svix-signed inbound webhooks) |
| Inbound email parsing | mailparser |
| SMS | Twilio (status callback webhook verified via `twilio.validateRequest`) |
| Object storage | Cloudflare R2 via `@aws-sdk/client-s3` + presigned URLs |
| Rate limits / lockout / re-auth | Upstash Redis + `@upstash/ratelimit` (sliding window) |
| i18n | next-intl 4 (locale messages in `src/messages/<locale>.json`; English-only at MVP) |
| Validation | zod 4 |
| Captcha | Cloudflare Turnstile (public submit form) |
| Tests | Vitest 4 (unit), Playwright 1.59 + `@axe-core/playwright` (e2e + a11y) |
| Lint | eslint-config-next + `eslint-plugin-jsx-a11y` (strict) + `eslint-plugin-i18next` |

---

## 2. Repository layout

```
axiom-ticketing/
├── AGENTS.md / CLAUDE.md            agent-facing instructions; read DESIGN_SYSTEM.md before touching UI
├── DESIGN_SYSTEM.md                 portable SynapseScope spec — color tokens, components, ticketing surfaces
├── DECISIONS.md                     running ADR-style log of non-obvious choices, dated, newest-first
├── drizzle.config.ts                schema → migrations pipeline (postgres dialect, strict + verbose)
├── next.config.ts                   reactCompiler on, security headers, next-intl plugin
├── eslint.config.mjs                next/typescript + strict a11y + i18n literal-string enforcement
├── playwright.config.ts             boots a dev server on port 3100; only `*.spec.ts` under `e2e/`
├── vitest.config.ts                 `src/**/*.test.ts(x)`; v8 coverage thresholds
├── components.json                  shadcn config (style: base-nova, css vars, lucide icons)
├── e2e/a11y.spec.ts                 axe-core sweep over key routes
├── src/
│   ├── app/                         Next.js App Router tree (see §6)
│   ├── components/                  React components grouped by feature (see §10)
│   ├── inngest/                     Inngest client + every background function (see §8)
│   ├── lib/                         Server-only utilities, DB, auth, email, SMS, storage, SLA, etc. (see §7)
│   └── messages/en.json             next-intl message catalog (English)
└── (no public/ logo assets are tracked here)
```

`@/*` resolves to `src/*` (tsconfig path).

---

## 3. Local setup

```bash
pnpm install
cp .env.example .env.local        # then fill in every required value
pnpm db:migrate                   # apply every migration in src/lib/db/migrations/ (REQUIRED — see below)
pnpm db:seed                      # 5 roles, role_permissions, ~30 default settings (idempotent)
pnpm db:seed-super-admin          # first Super Admin user via Better Auth API
pnpm dev                          # http://localhost:3000
```

Useful follow-ups:

- `pnpm db:seed-demo` — seeds realistic demo data on top of the base seed
- `pnpm db:backfill-customers` — one-shot, idempotent linker that binds `tickets.customer_id IS NULL` rows to any existing Customer account whose email matches `tickets.customer_email`
- `pnpm db:studio` — drizzle-kit web UI for inspecting the DB

> **Don't use `pnpm db:push` for production.** It syncs table shapes from the Drizzle schema but does NOT run the custom SQL at the bottom of `0000_sleepy_shockwave.sql` — the `ax_ticket_seq` sequence, the `generate_ticket_number()` function, and the `audit_log` permission lockdown. Ticket creation fails immediately ("function generate_ticket_number does not exist") without those. Always use `pnpm db:migrate` against production (and ideally dev too).

---

## 4. Environment variables

Defined in `.env.example`. All are read at runtime; missing values are logged loudly in dev and either fail closed (rate limits, lockout, webhook handlers) or throw in production (`getAppUrl`, `DATA_ENCRYPTION_KEY`).

| Group | Variable | Purpose |
|---|---|---|
| DB | `DATABASE_URL` | Neon Postgres connection string |
| Auth | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Better Auth signing + canonical URL. `BETTER_AUTH_URL` is the **base URL Better Auth uses to construct every email link** (magic-link verification, password-reset return). When unset, `lib/auth/index.ts:resolveBaseURL()` falls back to `NEXT_PUBLIC_APP_URL`; if both are missing in production, auth init throws. Without this configured properly, magic-link emails go out pointing at `http://localhost:3000`. |
| Crypto | `DATA_ENCRYPTION_KEY` | base64 32 bytes; AES-256-GCM envelope key for `lib/crypto.ts` |
| Tokens | `GUEST_TOKEN_SECRET`, `CSAT_TOKEN_SECRET`, `IMPERSONATION_TOKEN_SECRET` | HMAC keys for guest-ticket URLs, one-click CSAT, signed impersonation cookie |
| Object storage | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Cloudflare R2 attachments + avatars |
| Email | `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME` | Outbound + inbound webhooks (env vars override the DB settings) |
| SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Outbound SMS + `validateRequest` for status callbacks |
| Background | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Inngest production credentials |
| Anti-abuse | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | Cloudflare Turnstile for `/portal/submit` |
| Redis | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Rate limits, account lockout, re-auth freshness |
| Observability | `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `LOG_LEVEL` | Reserved; not wired up at the framework layer yet |
| App | `NEXT_PUBLIC_APP_URL` | Canonical origin used by email link builders + Twilio callback URL |
| First-run seed | `INITIAL_SUPER_ADMIN_EMAIL`, `INITIAL_SUPER_ADMIN_NAME`, `INITIAL_SUPER_ADMIN_PASSWORD` | Consumed once by `db:seed-super-admin`; remove from `.env.local` after |

**Fail-open vs fail-closed:** rate limits, account lockout, and re-auth freshness all fail OPEN in dev (with a console warning) and fail CLOSED only where the request can be rejected outright in production. The `lib/ratelimit.ts` module logs a hard error at module load when Upstash credentials are missing in production.

---

## 5. Database

### 5.1 Drizzle schema (`src/lib/db/schema/`)

Every table is declared here and re-exported from `schema/index.ts`. Column names follow Better Auth conventions where applicable — the `fields` mapping option is deliberately not used so this directory remains the single source of truth for the SQL schema and migrations stay clean.

| Module | Tables | Notes |
|---|---|---|
| `auth.ts` | `users`, `accounts`, `sessions`, `verifications`, `passkeys` | Better Auth core + app-specific columns (`language`, `phone` — optional E.164 string used by the SMS dispatch leg; `createdById`, `isActive`, `deactivatedAt`, `lockedUntil`, `lastLoginAt`). Phone is collected on the customer sign-up form, the customer profile, the admin user-create form, and the admin profile (all optional). Empty/null = no SMS for that user; the `dispatchNotification` function already gates on `r.phone` being truthy. |
| `rbac.ts` | `roles`, `role_permissions`, `user_roles` | Role names are strings; permission strings are validated by the closed set in `lib/auth/permissions.ts` |
| `organizations.ts` | `organizations`, `organization_domains`, `organization_trusted_emails` | Client companies (Meeting-2 CR-06). Unique `abbreviation` (2–5 alnum) used as the ticket-number prefix; `is_monthly_plan` + `monthly_minutes_included/balance` (integer **minutes**) + `monthly_plan_reset_at` + `negative_balance_alerted_at` for contract/billing tracking (see §15). `organization_domains` is the verifiable org-matching signal; `organization_trusted_emails` (migration `0017`) holds moderator-trusted foreign senders |
| `tickets.ts` | `tickets` | UUID PK + human-readable `ticket_number` (`generate_ticket_number(prefix, tz)` → `ORG-YYYYMMDD-NNN`). `status` CHECK now spans `draft`/`open`/`in_progress`/`awaiting_customer_confirmation`/`on_hold`/`escalation`/`resolved`/`closed` (migrations `0007`, `0026`); `category` is **no longer CHECK-constrained** — it stores a `ticket_categories.value` slug (migration `0024`) so the set is admin-managed. `type` (migration `0025`, default `service_request`) is a second, independent admin-managed taxonomy resolved against `ticket_types`. Other CHECKs: priority/stream/origin/csat/csat_rating/escalation_reason/billable/org_match_status. App columns: `organization_id`, `billable`, `escalation_target_role`, `monthly_plan_deducted_minutes`, `sla_paused_at` (SLA-pause clock, §13), `csat_rating` (3-way, §20), `created_via`, `customer_attribution_unverified` (§18) |
| `ticket-categories.ts` | `ticket_categories` | Admin-managed replacement for the old fixed category CHECK (migration `0024`). `value` (immutable slug) + editable `label`, `sort_order`, `is_active` (deactivate, never delete), one `is_default` row. Managed at `/admin/categories` |
| `ticket-types.ts` | `ticket_types` | Same shape as `ticket_categories` (migration `0025`) for the independent "type of work" taxonomy (Service Request/Incident/Change/Project/Alert, seeded), plus an `icon` column (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `pnpm db:add-ticket-type-icon`) — one of the 30 keys in `lib/tickets/type-icon-keys.ts`, chosen per type (not computed from list position) and rendered wherever the type shows up, e.g. the sidebar sub-nav under Tickets (§10). Managed at `/admin/types` |
| `ticket-assignees.ts` | `ticket_assignees` | Multi-technician junction (CR-11). Primary assignee stays on `tickets.assigned_to_id`; this holds additional collaborators |
| `ticket-email-refs.ts` | `ticket_email_refs` | Migration `0028`. `(rfc_message_id UNIQUE → ticket_id)` — captures inbound `Message-ID`/`References` headers so `resolveTicketByMessageRefs` can thread a reply even when the `[AX-XXXX]` subject tag and `ticket+AX-XXXX@` sub-address are both missing (falls back to `resolveTicketBySubjectSender`) |
| `ticket-reviews.ts` | `ticket_reviews` | CSAT feedback, append-only (migration `0023`, §20). `rating` ∈ {happy, neutral, unhappy}; `comment` (mandatory at the app layer for `unhappy`); snapshotted `technician_id`/`technician_name`; `submitted_via` ∈ {portal, email}. Source of truth for CSAT reporting; `tickets.csat_rating`/`csat_response` hold only the latest value for the close/reopen state machine |
| `work-logs.ts` | `work_logs` | Technician work entries (CR-12): description, integer `minutes`, `service_type` ∈ {onsite, remote}, auto timestamp. Every insert/update/delete re-syncs the ticket's org's monthly-plan deduction (`syncMonthlyPlanDeduction`, §15) |
| `messages.ts` | `messages` | `author_type` ∈ {agent, customer, system}, `channel` ∈ {email, portal, dashboard, system}, `body_format` ∈ {text, html}, `is_internal_note`, `is_resolution_note`, `is_anonymized`, `moderation_status` ∈ {approved, held, rejected} (default approved) + `reviewed_by_id`/`reviewed_at` for the held-inbound-message moderation queue (§18) |
| `attachments.ts` | `attachments` | Bounded size (≤10 MiB), `scan_status` ∈ {pending, clean, quarantined}, partial indexes for the pending-scan queue and orphan-cleanup window |
| `procurement.ts` | `procurement_requests` | Four single-select stages (CR-26): `awaiting_customer_payment` → `order_pending` → `order_placed` → `order_completed`. Type ∈ {hardware, software, other}. **No approval/urgency** (removed in `0010`); stage-change actor/time lives in the audit log |
| `audit.ts` | `audit_log` | Append-only; UPDATE/DELETE are revoked at the database role level in the initial migration and hardened further in `0021`; indexes for timestamp, actor, action, target, request_id; `target_label` column (added alongside `0021`) is a best-effort human label snapshotted at write time (`targetLabelSnapshot()`) so a row stays legible after its target is renamed or hard-deleted |
| `audit-filter-presets.ts` | `audit_filter_presets` | Migration `0029`. Named, shared, saveable audit-page filter bookmarks (`name` + raw `query_string` + `created_by_id`), gated only on `audit.view` |
| `mcp-tokens.ts` | `mcp_tokens` | Migration `0030`. Bearer tokens (`axmcp_…` prefix, SHA-256 hashed, revocable) a user mints from their own profile to authenticate the MCP server (§23) as themselves — gated on the `mcp.connect` permission (migration `0031`, backfilled via `pnpm db:add-mcp-connect-permission`) |
| `notifications.ts` | `notifications`, `notification_preferences` | Bodies stored as i18n `titleKey`/`bodyKey` + JSON args so render-time locale wins; preferences keyed by `(user, event_type)` |
| `settings.ts` | `settings` | Key/value JSON store with audit metadata |
| `webhooks.ts` | `processed_webhook_events` | `(provider, event_id)` idempotency log; receivedAt index for cleanup |
| `failed-notifications.ts` | `failed_notifications` | Dead-letter queue after Inngest retries are exhausted |
| `holidays.ts` | `holidays` | Admin-editable; SLA computation skips these for priorities with `respect_business_hours = true` |

### 5.2 Migrations

SQL migrations live in `src/lib/db/migrations/`. The initial migration also creates the `generate_ticket_number()` function and revokes UPDATE/DELETE on `audit_log` from the application DB role. Use `pnpm db:generate` to produce a new migration from schema diffs, `pnpm db:migrate` to apply, or `pnpm db:push` for direct schema sync in dev.

### 5.3 Client wiring (`src/lib/db/client.ts`)

- **HTTP driver** (`drizzle-orm/neon-http`) is the default `db` export. It is wrapped in a transient-retry `fetch` (200 / 600 / 1500 ms backoff on `fetch failed` / 408 / 425 / 429 / 5xx) so Neon cold-starts and gateway hiccups don't surface as user-visible errors. In dev, every retry logs `[neon-http]` with the inner cause and any `AggregateError` children.
- **WebSocket Pool** (`drizzle-orm/neon-serverless`) is constructed lazily on first transaction. `transactional(fn)` is the one supported way to wrap multi-statement writes — `db.transaction()` does not work on the HTTP driver. The pool is cached on `globalThis.__neonPool` so HMR doesn't leak fresh pools per edit.

### 5.4 Seeds

- `seed.ts` — 5 roles, role_permissions, ~30 default settings. Skips if any role already exists.
- `seed-super-admin.ts` — calls `auth.api.signUpEmail` once to create the first user, then attaches the Super Admin role. Idempotent on email.
- `seed-demo.ts` — populates realistic demo data on top of the base seed.
- `backfill-customer-ids.ts` — bulk linker mirroring the auth hook in §6.3.

---

## 6. Routes

The App Router tree is split into two route groups: `(admin)` and `(public)`. The root `src/app/page.tsx` redirects every visitor to the surface their session indicates: anonymous → `/portal/sign-in`, strict customer → `/portal`, anyone else → `/admin`.

`src/app/layout.tsx` loads the Roboto + Geist Mono Google fonts, mounts `NextIntlClientProvider`, and applies the global stylesheet. `src/app/global-error.tsx` is the bare-HTML last-resort renderer when every nested boundary fails (no provider in scope, so its copy is intentionally English-only).

### 6.1 Admin (`src/app/(admin)/admin/…`)

- `login/` — credential sign-in form (server action `signInWithLockout` from `src/app/actions/sign-in.ts`)
- `setup/` — first-time password setup flow; consumes Better Auth reset tokens issued by `auth.sendResetPassword`
- `(gated)/` — every route below this segment is protected by `layout.tsx`, which (a) requires a valid Better Auth session, (b) enforces the 12-hour idle timeout by inspecting `session.updatedAt`, (c) renders the sidebar + topbar + impersonation banner, and (d) hosts the `<main id="main-content">` landmark
  - `page.tsx` — dashboard with permission-gated quick stats + section cards
  - `tickets/`, `tickets/new`, `tickets/[id]` — the list table has no Type column; type filtering is a sidebar concern (see §10 below), not a page control. The one filter row on the page is a single segmented control — Active / Awaiting Customer / On Hold / Closed/Resolved / All — spanning two independent query params (`view` for Active/Closed/All, `status` for the two chips) but kept mutually exclusive at the href level (each link clears the other param before setting its own) so exactly one segment is ever lit, not a tab-bar-that-looks-single-select-but-isn't. Each of the first four is an **exact status partition**, not a loose scope: Active = `open`/`in_progress` only, Awaiting Customer = `awaiting_customer_confirmation` only, On Hold = `on_hold` only, Closed/Resolved = `closed`/`resolved` — every one of the 6 ticket statuses belongs to exactly one tab. All imposes no status restriction. The Status column-header filter (in `tickets-table`) can still narrow further within whichever tab is active, but can't escape it
  - `procurement/`, `procurement/[id]`
  - `organizations/`, `organizations/new`, `organizations/[id]` — client-company registry (Meeting-2 CR-06)
  - `users/`, `users/new`, `users/[id]`, `users/import` — the customer-import wizard (§17); paste/upload a CSV of customers, resolve orgs, commit via background batch
  - `roles/`, `roles/new`, `roles/[id]`
  - `hierarchy/` — visual creator-tree (includes any user with at least one non-Customer role via a correlated `EXISTS` subquery on `user_roles`; pure-Customer accounts are filtered out, but all staff roles — including Technicians who can't themselves create users — remain so Super Admin's descendants are visible)
  - `categories/`, `types/` — admin-managed ticket taxonomies (`ticket_categories`/`ticket_types`, §5.1), both gated on `settings.update` and built on the shared `TaxonomyTable`/`AddTaxonomyButton` components
  - `moderation/` — held inbound-message queue (§18); approve-once / approve-and-trust / reject
  - `work-log/` — cross-technician timesheet (`worklog.view_all` unlocks seeing everyone's entries; without it, a user sees only their own)
  - `reports/`
  - `settings/`
  - `audit/`
  - `profile/` — also where a user mints/revokes their own MCP tokens (§23)

### 6.2 Public (`src/app/(public)/…`)

`(public)/layout.tsx` adds the skip-link and `<main id="main-content">` landmark for every public surface.

- `portal/sign-in`, `portal/sign-in/sent` — magic-link primary, password fallback
- `portal/sign-up`, `portal/sign-up/<form>` — magic-link sign-up
- `portal/submit`, `portal/submit/success` — anonymous public submission form (Turnstile-gated)
- `portal/(authenticated)/` — customer-role-only group; layout redirects non-Customers to `/admin`. Layout now mirrors the admin shell: a sticky `<CustomerSidebar>` on `lg+` (Home / My Tickets / Profile + a prominent "+ New ticket" CTA), the existing `<CustomerTopbar>` with a notifications bell, and the children area. Below `lg` the sidebar hides and the topbar's second-row nav strip takes over.
  - `page.tsx` — **dashboard at `/portal`**: ticket-count stat cards (Open / In progress / Resolved), five most-recently-updated tickets, prominent New-ticket CTA
  - `tickets/` — customer ticket list with status-chip filters (`All / Open / In progress / Resolved`) and a search input (subject or ticket number); URL-driven (`?status=…&q=…`) so it's bookmarkable
  - `tickets/new`
  - `tickets/[ticketNumber]` with `loading.tsx` and `not-found.tsx`
  - `profile/` — name, email (read-only), phone (E.164, optional — enables SMS notifications), language, avatar, notification preferences (email + SMS toggle per event)
- `portal/guest/tickets/[ticketNumber]` — token-authenticated view for visitors who haven't signed up; reads the `?token=` HMAC built by `guestTicketUrl`
- `csat/confirm` — one-click HMAC-verified CSAT confirmation (route handler, no UI)
- `csat/result` — confirmation landing page

### 6.3 API (`src/app/api/…`)

- `auth/[...all]/route.ts` — Better Auth Next.js handler (sign-in, sign-out, magic-link, reset-password)
- `inngest/route.ts` — Inngest serve route (exports `GET`, `POST`, `PUT`)
- `email/inbound/route.ts` — Resend inbound webhook: verifies Svix signature → rate-limits (1000/min) → records `(provider=resend, svix-id)` for idempotency → normalizes payload → emits `email/inbound.received` Inngest event. Returns 200 for already-processed events.
- `twilio/status/route.ts` — Twilio status callback: verifies `x-twilio-signature` via `twilio.validateRequest` → dedupes by `(provider=twilio, sid:status)` → logs the transition (failed/undelivered escalated to `console.error`)
- `audit/export/route.ts` — CSV is a streamed, unbounded `ReadableStream` (bypasses the shared export lib); XLSX/PDF route through it (gated by `audit.export`); filters mirror the dashboard UI
- `reports/export/route.ts` — ticket health + procurement spend summary (gated by `reports.export`)
- `tickets/export/route.ts`, `organizations/export/route.ts`, `roles/export/route.ts`, `users/export/route.ts`, `procurement/export/route.ts` — CSV/XLSX/PDF exports (§16) gated respectively by `tickets.export`, `organizations.view`, `roles.view`, `users.view`, `procurement.export`; `tickets` caps at 5000 rows, `users` at 10000
- `mcp/route.ts` — MCP server endpoint (§23); GET/POST/DELETE via `WebStandardStreamableHTTPServerTransport`, authenticated by an `mcp_tokens` Bearer token instead of a session cookie

### 6.4 Customer reconciliation hook

`src/lib/auth/index.ts` registers `databaseHooks.user.create.after` which calls `assignCustomerRole(user.id)` then `claimTicketsForCustomer(user.id, user.email)`. The latter is the atomic `UPDATE tickets SET customer_id = $1 WHERE customer_id IS NULL AND lower(customer_email) = lower($2)` that adopts legacy/anonymous tickets when a customer signs up. It is idempotent and shared with `pnpm db:backfill-customers`. See `DECISIONS.md` 2026-05-10 for the rationale.

### 6.5 Edge proxy (`src/proxy.ts`)

Next.js 16 renamed the `middleware.ts` convention to `proxy.ts`. Two responsibilities:

1. **Auth pre-check** on `/admin/*` and `/portal/(authenticated)/*` — if no session cookie is present, redirect to the relevant sign-in page with `?from=<original-pathname>`. Full session validation still runs server-side in each gated layout via `getSessionUser()`.
2. **IP-based rate limit** of 5/minute on `/api/auth/sign-in/*` (per-account lockout is enforced separately inside the sign-in Server Action).

**Session-cookie name resolution:** Better Auth promotes its cookie to the `__Secure-` prefix over HTTPS (browser security convention — `__Secure-` cookies can only be set over TLS). The proxy's helper `hasBetterAuthSessionCookie(req)` checks BOTH `better-auth.session_token` (HTTP / local dev) and `__Secure-better-auth.session_token` (HTTPS / production). Without this, the proxy in production never sees the cookie Better Auth just set after a successful magic-link verification and redirects the user right back to the sign-in page.

**Public-on-purpose exclusions under `/admin`:** `/admin/login` (front door) and `/admin/setup` (where the staff setup-invite email lands so a fresh user can pick a password BEFORE they have any way to authenticate). Both are reachable without a session — gating either would create a redirect loop.

---

## 7. `src/lib/` — server-only services

| Module | Responsibility |
|---|---|
| `audit.ts` | `audit({...})` — single insert into `audit_log`; auto-detects active impersonation cookie and stamps `impersonatorId` when present; calls `targetLabelSnapshot()` to fill `target_label` when a caller doesn't pass one explicitly |
| `audit/action-label.ts` + `audit/diff.ts` | `action-label.ts` renders a human-friendly label for an `action` string (drives the audit UI + CSV); `diff.ts` renders the `before`/`after` JSON diff shown in the details modal |
| `auth/` | Better Auth setup + `getSessionUser` / `requireSessionUser` (returns the impersonated identity when an `axiom_imp` cookie is valid), `session.ts` (also exports `loadSessionUserById` — builds a full `SessionUser` from a raw user id with no cookie/request context, used by the MCP connector), `can()` permission gate, `productionContext` (DB-backed `isDescendantOf` / `userHasRole` / `isLastActiveSuperAdmin`), `ticketsVisibilityCondition`, `permissions.ts` (closed set + per-role defaults, incl. `mcp.connect`), `permission-diff.ts` (`permissionsBeyondCaller` — "can't grant what you don't have," shared by the admin role/user actions AND the MCP role/user write tools), `lockout.ts` (Redis-backed 5-failure / 15-minute window), `reauth.ts` (5-minute freshness for sensitive actions), `impersonation.ts` (HMAC-signed cookie), `client.ts` (Better Auth React client), `mcp-tokens.ts` (`resolveMcpToken` — hashes + looks up an `mcp_tokens` Bearer token, re-checks `mcp.connect` on every call, rebuilds a full `SessionUser` for the MCP server, §23) |
| `billing/` | Accountant-facing billing pipeline (§15): `accountants.ts` (`getAccountantRecipients` — resolves the global settings-configured contact list ± Super Admin copy), `events.ts` (`notifyBalanceChanged` / ticket-resolved event emitters), `outcome.ts` (`deriveBillingOutcome`, pure, tested), `plan-watch.ts` (`loadPlanWatch` — proactive over-plan/low-balance dashboard watchlist), `usage.ts` (pure per-category usage-breakdown helpers for the org detail page) |
| `branding/` | `loadBranding()` reads the `branding` setting, normalizes against known presets, falls back to `DEFAULT_BRANDING`; `presets.ts` enumerates accent + gradient classes (all class names appear as literals so Tailwind JIT keeps them) |
| `crypto.ts` | AES-256-GCM envelope encrypt/decrypt for sensitive fields. No callers yet — reserved for future encrypted-at-rest columns |
| `customer/` | `reconcile.ts` (Better Auth hook helpers), `queries.ts` (customer-scoped `listMyTickets`, `getMyTicketByNumber`, `getGuestTicket`, `getMyMessageThread` — internal notes filtered at the SQL layer via `customerVisibleMessages()`), `invite.ts` (`sendCustomerSetupInvite` — the customer-specific "set your password" HMAC-token invite, distinct from the staff Better Auth reset-token flow, §22; refreshes from the live `customer_invite.expiry_hours` setting on every (re)send) |
| `customer-import/` | Bulk customer-CSV import support (§17): `domain-guess.ts` (free-mail deny-list + `guessOrgNameFromDomain`), `domain-resolution.ts` (`resolveDomainsForImport` — batch-resolves distinct email domains against known orgs in one query) |
| `db/` | Drizzle client (HTTP + WS Pool), schema, migrations, seed scripts |
| `email/` | Resend client, `sendEmail` wrapper (renders React Email templates → resolves locale → adds optional `Reply-To: ticket+AX-XXXX@<domain>` and `From: "Name — Brand"` display), Svix signature verifier, inbound payload normalizer + ticket-number extractor, inbound filter (auto-reply / bounce / list-mail / empty-after-strip), quote/signature stripper, `fetch-inbound.ts` (Resend's inbound webhook is METADATA-ONLY — this fetches the full `text`/`html`/`headers` via `GET /emails/receiving/{id}` before normalizing; rolls back the idempotency row and lets Resend retry on fetch failure), `auth-results.ts` (`senderAuthVerdict` — DMARC-aligned / aligned-DKIM-or-SPF parser used to gate auto-posting, §18) |
| `email/templates/` | React Email templates incl. `account-lockout`, `attachment-quarantined`, `customer-magic-link`, `customer-welcome`, `escalation-alert`, `inbound-bounce`, `inbound-closed-ticket`, `new-assignment`, `procurement-*` × 4, `staff-setup-invite`, `ticket-*` × 6, `accountant-negative-balance`, `accountant-ticket-billing` (§15) + `_layout.tsx` |
| `errors.ts` | `ForbiddenError`, `NotFoundError` — only two error subclasses used by Server Actions |
| `export/` | Shared CSV/XLSX/PDF export pipeline (§16): `dataset.ts` (format-agnostic `ExportDataset`/`Section` types), `csv.ts` (formula-injection-safe + BOM), `xlsx.ts` (ExcelJS — Summary sheet + one sheet per table), `pdf.ts` (pdfkit — branded, paginated), `respond.ts` (`exportResponse()`, the single dispatcher every export route calls), `branding-assets.ts` (pulls logo/accent from settings for XLSX/PDF) |
| `format.ts` | `formatBytes`, `initials` |
| `i18n.ts` | next-intl request resolver + `pickLocale` helper |
| `mcp/` | `server.ts` (`buildMcpServer` — registers the 8 read tools + `add_ticket_note`, then delegates to the registrars below), `queries.ts` (read-tool implementations — every read re-runs `can()` + `ticketsVisibilityCondition(user)`). Write-tool modules, one per domain, each pairing a `*ViaMcp` function (the mirrored business logic) with a `register*WriteTools` registrar: `tickets-write.ts` (13 tools: create/assign/delete/merge/reply/resolve/reopen/status/priority/category/type/escalate/deescalate — no `close_ticket` yet, see §23), `users-write.ts` (create/update/deactivate/reactivate/unlock/reset-password — 6 tools), `roles-write.ts` (create/update/delete — 3), `organizations-write.ts` (create/update/add-hours/delete — 4), `procurement-write.ts` (create-request/set-status — 2), `settings-write.ts` (add/remove-holiday, a refusal-only `update_setting`, plus 2 self-scoped notification-preference tools), `categories-types-write.ts` (5 CRUD tools × ticket-categories and ticket-types = 10), `audit-write.ts` (`summarize_audit_log` — read-only despite the filename). See §23 |
| `messages/` | `sanitize.ts` — `sanitize-html` allowlist matching what TipTap can produce, with `transformTags` rewriting every `<a>` to carry `target="_blank" rel="noopener noreferrer"` and `allowedSchemes` restricted to `http/https/mailto` (blocks `javascript:` / `data:` URLs). Pure-CommonJS package by design — does NOT use jsdom, so we don't take on the ESM-interop landmines that come with isomorphic-dompurify. Plus `visibility.ts` (SQL predicate hiding internal notes AND held/rejected moderated messages from customer + non-moderator queries). |
| `notifications/` | `registry.ts` maps every `NotificationEventType` to its in-app `titleKey`/`bodyKey`; `sms-types.ts` defines the SMS template union without importing Twilio |
| `organizations/validation.ts` | Shared organization-form validation (`normalizeAbbreviation`/`ABBREVIATION_RE`, `normalizeDomains`, `conflictingDomains`, `abbreviationTaken`, `nameTaken`, `hoursToMinutes`) extracted out of the `"use server"` action file so both `app/actions/organizations.ts` and the MCP `organizations-write.ts` tools (§23) share one implementation |
| `ratelimit.ts` | Named Upstash sliding-window limiters covering public submit, login, password reset, inbound email flood, every authenticated per-user-per-action, and customer-portal flows |
| `reports/queries.ts` | Ticket health + procurement spend aggregates, plus the CSAT reporting surface (§20) sourced from `ticket_reviews`: `loadCsatBreakdown`, `loadCsatQuality`, `loadCsatMonthlyTrend`, `loadCsatByTechnician`, `loadCsatByOrganization`, `loadCsatRecentComments` |
| `request.ts` | `getAppUrl` + `clientIp` (X-Forwarded-For-aware) |
| `settings.ts` + `settings-registry.ts` | `getSetting(k)` / `getSettings([…])` readers + a zod schema map describing every writeable settings key. `READ_ONLY_AFTER_FIRST_SET` includes `inbound_email_domain` |
| `sla.ts` + `sla-compute.ts` | DB-backed SLA settings loader + pure DST-aware business-hours math (`computeDueAt`). The pure module is testable without `DATABASE_URL` |
| `sms/` | Twilio lazy client + `sendSms` wrapper that renders SMS bodies via next-intl namespaces, points status callbacks at `/api/twilio/status`, never throws on missing app URL |
| `storage/` | R2 client (`client.ts`), `presignUploadUrl` (5-minute PUT), `getSignedDownloadUrl` (5-minute GET, 1-hour for avatars), `fetchObject` / `fetchObjectPrefix`, `deleteObject`, MIME allowlist + filename sanitizer (`mime.ts`), magic-byte verification (`magic-bytes.ts`), virus-scan abstraction (`virus-scan.ts` selects `disabled` | `eicar` | `clamav-rest`) |
| `tickets/billing.ts` | `syncMonthlyPlanDeduction` (§15) — idempotent delta-sync of a ticket's Monthly-Plan minute deduction against its org's balance; called from every work-log mutation inside the same transaction |
| `tickets/csat.ts` + `csat-apply.ts` + `csat-display.ts` + `reviews.ts` | The 3-emoji CSAT model (§20): rating metadata (`csat.ts`), the single transactional write path shared by the portal + email entry points (`csat-apply.ts:recordCsatResponse`), display helpers, and `ticket_reviews` read queries |
| `tickets/inbound-threading.ts` | `resolveTicketByMessageRefs` (joins `ticket_email_refs` on RFC `Message-ID`/`References` headers) with `resolveTicketBySubjectSender` as the fallback when no ref was captured — a second threading signal alongside the `[AX-XXXX]` tag / sub-address (§18) |
| `tickets/load.ts` | `loadTicketScope` (superset projection used by every action), `listAssignableTechnicians` (anyone whose role grants `tickets.update`) |
| `tickets/org.ts` | `resolveTicketOrgForGuest` / `resolveTicketOrgById` — produce the ticket's `org_match_status` (`account`/`domain`/`staff`/`unverified`/`none`); a typed company name never auto-links, only a verified email-domain match does |
| `tickets/participants.ts` | `classifyInboundSender` — customer / participant / org-domain / org-trusted / foreign classification driving auto-post vs. moderation-hold (§18) |
| `tickets/stream.ts` | `classifyStream(email)` — single source of truth for "internal vs external" on every ticket-creation path. **Role beats domain**: if the email maps to an active user holding any staff role (Super Admin / IT Director / Coordinator / Technician), the ticket is internal regardless of email domain; otherwise the `internal_email_domains` allowlist applies. Used by `createTicket`, `createTicketOnBehalf`, `customerCreateTicket`, and the inbound-email processor. See `DECISIONS.md` 2026-05-21. |
| `tickets/type-icon-keys.ts` + `type-icons.tsx` | The 30-icon vocabulary for `ticket_types.icon`. `type-icon-keys.ts` is pure data (no `lucide-react` import, safe for schema/action/MCP code): `TICKET_TYPE_ICON_KEYS`, `isTicketTypeIconKey`, `suggestTicketTypeIcon(label)` (keyword match, used only to pre-fill the create-form picker — never applied silently). `type-icons.tsx` maps every key to its `LucideIcon` (`satisfies Record<...>` catches a missing mapping at compile time) and exports `resolveTicketTypeIconKey` — deliberately returns a *key*, not a component, since binding a component produced by a function call to a variable that's later rendered as a JSX tag trips the `react-hooks/static-components` lint rule; callers index `TICKET_TYPE_ICON_COMPONENTS[resolveTicketTypeIconKey(x)]` directly at the render site instead |
| `ticket-number.ts` | Calls the Postgres `generate_ticket_number()` function |
| `tokens.ts` | HMAC guest tokens (`signGuestToken` / `verifyGuestToken` / `guestTicketUrl`), CSAT tokens (`signCsatToken` / `verifyCsatToken`), and the customer-invite token (`signCustomerInviteToken`) — payloads are `<field>|<field>:<sig>` base64url-encoded |
| `turnstile.ts` | Server-side Cloudflare Turnstile verification; skips in dev when `TURNSTILE_SECRET` is unset, hard-fails in production |
| `users/invite-status.ts` + `users/provision.ts` | `computeInviteStatus` derives `active`/`invited`/`invite_expired` from `users.invited_at`/`invite_expires_at`/`invite_accepted_at` (no stored status column); `provision.ts` is the shared user-creation core (Drizzle-direct `users`+`accounts` insert, §22) used by both `createUser` and the customer-import batch processor |
| `utils.ts` | `cn(...)` (clsx + tailwind-merge) |
| `work-logs/queries.ts` | Cross-ticket read queries backing the `/admin/work-log` timesheet: `listWorkLogs`, `listLoggableTickets`, `listUserCollaboratorTicketIds`, `listOrganizationsForFilter` — scoped to the caller's own entries unless they hold `worklog.view_all` |

### 7.1 Tests under `lib/`

Pure-logic modules ship with co-located vitest files: `crypto.test.ts`, `sla-compute.test.ts`, `tokens.test.ts`, `messages/sanitize` (covered indirectly), `storage/magic-bytes.test.ts`, `storage/mime.test.ts`, `storage/virus-scan.test.ts`, `email/inbound-filter.test.ts`, `email/inbound-payload.test.ts`, `email/webhook-signature.test.ts`, `email/auth-results.test.ts` (9 sender-auth regression cases), `auth/can.test.ts`, `billing/outcome.test.ts`, `customer-import/domain-guess.test.ts`. Coverage thresholds (vitest) are 50% lines/functions/statements, 40% branches.

---

## 8. Inngest functions (`src/inngest/`)

`client.ts` defines the typed event union (`Events`) and the dispatch payload (`NotificationDispatchPayload`). `functions/index.ts` re-exports every function; `/api/inngest/route.ts` serves them.

| Function | Trigger | What it does |
|---|---|---|
| `auto-close-resolved-tickets` | cron `0 * * * *` | Closes resolved tickets older than 24h that the customer never CSAT-confirmed; sends `ticket_closed`; audits `ticket.auto_close` with `actorId: null` |
| `process-inbound-email` | event `email/inbound.received` | Filter → extract ticket number (§18, now also checks `ticket_email_refs`) → either reply to the customer (bounce / closed-ticket) or insert message (held for moderation when the sender isn't recognized + auth-verified) + ingest attachments + dispatch `ticket.customer_replied`. When no ticket number is found, opens a fresh ticket from the email (honoring `inbound_sender_allowlist_only`) |
| `process-customer-import-batch` | event `customer-import/batch.requested` | Provisions every validated row from the customer-import wizard (§17) via `users/provision.ts`, outside the request/response cycle so large batches don't time out |
| `scan-attachment` | event `attachment/uploaded`, 2 retries | Loads row → fetches bytes from R2 → routes through `scanBytes` → on `infected` flips to `quarantined`, deletes the R2 object, audit-logs, dispatches `attachment.quarantined`. Falls open to `clean` after scanner errors (still audited) |
| `sla-monitor` | cron `*/20 * * * *` | Scans in-flight tickets, marks 50% / 80% / 100% transitions exactly once via the dedicated stamp columns. Skips tickets with `sla_paused_at` set (§13). Every tier notifies the assignee (if any) plus the admin-configured staff roles for that tier — `sla.warning_notify_roles` for 50%/80%, `sla.breach_notify_roles` for the breach; both default to Super Admin/IT Director/Coordinator. 50% is in-app only; 80% adds SMS; a breach adds email too and audits `ticket.sla_breach` |
| `unassigned-ticket-monitor` | cron `*/20 * * * *` | Settings-driven (`unassigned_alert.*`): emails Coordinator/IT Director/Super Admin about any open ticket unassigned past a configurable threshold; re-nags on a configurable cadence; claim-then-check on `tickets.unassigned_reminder_at` prevents double-sends across overlapping runs |
| `customer-followup-monitor` | cron `0 */6 * * *` | Settings-driven (`customer_followup.*`): a ticket sitting in `awaiting_customer_confirmation` with no customer reply since the agent's last message gets a one-time nudge email after `followup_days`, then auto-closes (`customer_no_response`) after `close_days` more. Clock resets whenever a fresh agent (or customer) message lands |
| `cleanup-stale-drafts` | cron `15 4 * * *` | Deletes `draft`-status tickets (+ their R2 attachments) older than 24h — pre-submission drafts that let a customer attach files before the ticket is real, but leak ticket numbers/objects if abandoned |
| `dispatch-notification` | event `notification/dispatch` | Resolves recipients from `recipientUserIds` ∪ `recipientRoles`, loads `notification_preferences`, fans out into per-recipient `notification/email` / `notification/sms` / `notification/in-app` events |
| `send-email-notification` | event `notification/email`, 3 retries | Calls `sendEmail` |
| `send-sms-notification` | event `notification/sms`, 3 retries | Calls `sendSms` |
| `send-in-app-notification` | event `notification/in-app`, 3 retries | Inserts into `notifications` with i18n keys + arg JSON |
| `monthly-plan-reset` | cron `0 6 * * *` | Resets each Monthly-Plan org's balance to its included minutes at most once per UTC calendar month (no rollover); clears `negative_balance_alerted_at` (§15) |
| `billing-balance-monitor` | event `billing/balance.changed` | Atomically claims a negative-balance episode on `organizations.negative_balance_alerted_at` (alerts exactly once per dip; clears on recovery) and emails/SMSes the accountant contacts (§15) |
| `notify-accountant-resolved` | event `billing/ticket.resolved` | On ticket resolution, derives a billing outcome (`deriveBillingOutcome` — billed/pending/none/review) from the ticket's `billable` value + work-log minutes and emails accountants (skips `none`) (§15) |
| `cleanup-old-notifications` | cron `30 3 * * *` | Sets `archivedAt` on rows older than 90 days |
| `cleanup-stale-lockouts` | cron `45 3 * * *` | Clears `users.locked_until` rows whose timestamp has passed (safety net for the durable mirror; Redis TTL handles steady state) |

---

## 9. Server Actions (`src/app/actions/`)

Every privileged write lives here. The convention across every file:

1. Call `requireSessionUser()` to load the session-bound `SessionUser`.
2. Call `enforceUserRateLimit('<bucket>', user.id)` for any user-controlled action with a real-world abuse vector.
3. Validate the input with a co-located zod schema (Next.js 16 forbids non-async exports from `"use server"` files — schemas stay module-private).
4. Call `can(user, '<permission>', target, productionContext)`. Throw `ForbiddenError` if it fails.
5. Mutate inside `transactional(...)` whenever multiple statements must be atomic; otherwise direct `db.*`.
6. Call `audit({...})` after a successful state change. The helper auto-fills `impersonatorId` when an active impersonation cookie is present.
7. `revalidatePath(...)` for any pages that read the changed data.

| File | Highlights |
|---|---|
| `tickets.ts` | `createTicket` (public, Turnstile + IP + email rate-limit + honeypot), `createTicketOnBehalf`, `prepareGuestTicketDraft`, `assignTicket`, `replyToTicket`, `addInternalNote`, `resolveTicket` (note / skip discriminated union), `reopenTicket`, `closeTicket` (`tickets.close` — Coordinator/IT Director/Super Admin only; requires the ticket to already be `resolved`; dispatches the same `ticket_closed` customer notification + `dispatchTicketClosedStaff` oversight alert used by the CSAT/auto-close paths, with `reason: "staff"`, §20), `escalateTicket` (categorical reason + optional note, stamps `sla_paused_at`, §13), `deescalateTicket`, `deleteTicket` (soft delete), `mergeTickets` (moves messages + attachments, closes source with `duplicate_of_id`; `listMergeCandidates` backs the picker; `tickets.merge` is Super-Admin-only, distinct from `tickets.delete`), `setTicketStatus` (the general status-transition entrypoint — rejects resolved/closed/draft as a source state; handles the `awaiting_customer_confirmation`/`on_hold` SLA-pause/resume, §13), `setTicketPriority`, `setTicketCategory` / `setTicketType` (validate against the active `ticket_categories`/`ticket_types` rows), `setTicketCustomer` (+ `searchTicketCustomers`), `setTicketInvoiceNumber`, `setTicketBillable` |
| `categories.ts` / `ticket-types.ts` | CRUD for `ticket_categories` / `ticket_types` (create, rename, reorder, set-default, deactivate — never hard-delete so historical tickets keep their label). Gated on `settings.update`. Types only: `createType(label, icon?)` / `renameType(id, label, icon?)` take an optional icon key (§5.1) — create falls back to `suggestTicketTypeIcon(label)` when omitted/invalid so even an MCP-created type lands on something relevant; rename only touches the icon when one is explicitly (and validly) passed, never re-suggesting on top of an already-chosen one |
| `work-logs.ts` | `addWorkLogEntry`, `updateWorkLogEntry`, `deleteWorkLogEntry`, `listWorkLogsForTicket`. Gated on `tickets.update` (assignment-scoped for a strict technician) plus a "frozen history" rule: an entry is editable/deletable only by its original author, and only while that author is still assigned to the ticket — enforced explicitly here since `can(tickets.update)` doesn't scope elevated roles to assignment. Every mutation re-syncs the ticket's Monthly-Plan deduction (§15) |
| `moderation.ts` | `listHeldMessages`, `approveHeldMessage` ("approve once" — posts, sender stays moderated), `approveAndTrustHeldMessage` (posts + adds the sender to `organization_trusted_emails` org-wide, or as a ticket participant for a guest ticket), `rejectHeldMessage`. Gated the same as the ticket itself (`tickets.update`) |
| `customer-import.ts` | `previewCustomerImport` (zod-validates + flags duplicates/domain matches, capped at 500 rows, client-editable before commit), `commitCustomerImport` (re-validates server-side, creates any admin-approved new orgs synchronously, then fires one `customer-import/batch.requested` event for the actual provisioning). Both gated on `users.create` |
| `customer-invite.ts` | `acceptCustomerInvite` — consumes the HMAC customer-invite token (§22) to set a password and sign the customer in |
| `mcp-tokens.ts` | `createMyMcpToken` (shown once, prefix `axmcp_`), `revokeMyMcpToken`, `listMyMcpTokens` — self-service, user-owned, gated on `mcp.connect` (§12, §23) |
| `audit-presets.ts` | `listAuditFilterPresets`, `createAuditFilterPreset`, `deleteAuditFilterPreset` — named, shared audit-page filter bookmarks (raw query string), gated only on `audit.view` |
| `customer-portal.ts` | `requestMagicLink`, `requestSignUpMagicLink`, `customerReply` (always `authorType: 'customer'` + `channel: 'portal'`; never emails the customer back), `guestReply` (token-authenticated, no session, per-ticket + per-IP rate limits), `customerCreateTicket` (5/user/day) |
| `users.ts` | `createUser` — bypasses `auth.api.signUpEmail` and **inserts the `users` + `accounts` rows directly via Drizzle in a single `transactional`** (`accounts.password = null` until the user completes the setup-invite email). This avoids the session-issuing side effect of `signUpEmail` entirely, so the calling admin keeps their session no matter the cookie name Better Auth chooses across environments. A Customer-role target sends the customer-specific invite token (`sendCustomerSetupInvite`, §22) instead of Better Auth's staff reset-token flow. Plus the standard checks (cannot-grant-what-you-don't-have on role assignment; Super Admin grants require re-auth freshness; duplicate-email pre-check). Also: `updateUser`, `deactivateUser` / `reactivateUser`, `resetPassword` (staff → Better Auth `requestPasswordReset`; customer → `sendCustomerSetupInvite`), `unlockUser` (clears Redis + DB lockout), `getDescendants` (BFS over `createdById`, depth-capped at 50). |
| `roles.ts` | `createRole`, `updateRole`, `deleteRole` (refuses if any user holds it or if it's a system role). Permission-set diff respects "can't grant what you don't have" |
| `attachments.ts` | `generateUploadUrl` (validates MIME + size, mints R2 presigned PUT), `confirmUpload` (HEAD → magic-byte verify → emits `attachment/uploaded`), `getDownloadUrl` (5-minute signed GET; **doubly guards** internal-note attachments against strict customers), `deleteAttachment` |
| `audit.ts` | `listAudit` (paginated cursor), `getAuditDetail`, `iterAuditEntries` (async generator backing the CSV export). Read-only filters via zod |
| `procurement.ts` | `createProcurement` (Technician), coordinator approve/reject, admin approve/reject (when `procurement_approval_threshold` triggers two-step flow), `markPurchased`, `markDelivered`, `cancelProcurement`. Each transition dispatches the relevant notification + audits |
| `settings.ts` | `updateSetting` — looks up the zod schema in `SETTING_SCHEMAS`, enforces `READ_ONLY_AFTER_FIRST_SET`, requires re-auth freshness, audits before/after, `revalidatePath` for downstream pages. `addHoliday` / `removeHoliday` for the holidays table |
| `notifications.ts` | `getRecentNotifications` (polled by the bell icon every 30s), `markAsRead`, `markAllAsRead`, `updatePreference` (toggles email/SMS per event_type) |
| `impersonation.ts` | `startImpersonation` (no stacking), `endImpersonation`. Cookie max-age 1h; both ends audited |
| `reauth.ts` | `verifyReauth(password)` → calls Better Auth `verifyPassword` → marks Redis freshness flag for 5 minutes |
| `sign-in.ts` | `signInWithLockout` — pre-checks lockout, calls `auth.api.signInEmail`, records failures, fires `account_lockout` email exactly once when the threshold trips, clears the counter on success, mirrors `locked_until` into the users table |
| `setup.ts` | `setupPassword({ token, newPassword, email? })` — calls Better Auth `resetPassword`; on success, if `email` is supplied (carried in the setup-invite URL), follows up with `auth.api.signInEmail` so the user lands on `/admin` directly on first submit rather than bouncing through the login form. Returns `{ ok, signedIn }`. Opaque generic error message preserves token-privacy. |
| `profile.ts` | `updateProfile`, `changePassword`, `updateNotificationPreference`, avatar upload (presign → confirm → magic-byte verify → write to `users.image` → cleanup of any previous avatar key), `revokeSession`, `revokeAllOtherSessions`, `requestAccountDeletion` |
| `search.ts` | Backs the ⌘K palette: scoped tickets + users + procurement with per-entity limits and visibility filters |

---

## 10. Components (`src/components/`)

Organized by feature; shadcn primitives sit under `ui/` and are vendored (so consumers can restyle to the SynapseScope tokens without churning Tailwind classes).

- `ui/` — `button`, `input`, `card`, `dropdown-menu`, `badge`, `skeleton`, `avatar`, `separator`, `label`, `tooltip`, `textarea`, `dialog`, `popover` (thin `@base-ui/react/popover` wrapper mirroring `dialog`'s style — `Popover`/`PopoverTrigger`/`PopoverContent`/`PopoverClose`; backs the ticket-type icon picker, §10), `table`, `row-actions`, `rich-text-editor` (TipTap), `pagination`, `page-size-select`, `select`, `spinner`, `url-filter-select`, `url-search-input`, `data-table` + `data-table-column-header` (the generic sortable/filterable table — column `meta.filter: {kind:"enum"|"dateRange", ...}` drives per-column filter UI; backs both `tickets-table` and `work-log-table`, having superseded the older `MultiSelect`/`FilterCombobox` approach; also the first, pre-existing raw consumer of `@base-ui/react/popover`, left un-migrated to the new wrapper)
- `shared/` — `topbar`, `sidebar` + `mobile-nav` (both render the shared `sidebar-content`; each static `NAV_ITEM` declares the `Permission` it requires, and the gated layout passes the caller's permission array so the sidebar filters before rendering — a user never sees a link they can't reach). The "Tickets" item additionally gets a **dynamic sub-nav**: one link per active `ticket_types` row (`resolveTicketTypeIconKey(type.icon)` + the type's own label, e.g. `/admin/tickets?type=incident`) — the icon is the admin's own choice, stored on the row (§5.1), not derived from list position, so reordering/deactivating other types never changes it. Rebuilt from the admin-managed taxonomy on every request so a newly-added type appears with no code change — collapsed away in the icon-rail (`mini`) sidebar state, where a 3rd nesting level has no room for a label. `sidebar-content` reads `useSearchParams()` to highlight the active type, wrapped in `<Suspense>` per Next's recommended pattern (every `/admin/*` route is already forced dynamic, so this never actually suspends in practice). `profile-menu`, `notification-bell`, `global-search` (⌘K palette), `skip-link`, `impersonation-banner`, `reauth-modal` + `use-reauth-gate`, `export-menu` (the shared CSV/XLSX/PDF dropdown, §16, reused on tickets/organizations/roles/users/procurement/audit/reports)
- `tickets/` — `badges` (priority + status pills using the §13 token map), `tickets-table` (DataTable-based list + filters, incl. the billing filter, §16), `assign-control`, `reopen-button`, `close-ticket-button` (§20), `create-on-behalf-form`, `escalate-modal`, `resolve-modal` (note + skip), `reply-composer`, `message-thread`, `message-body`, `ticket-row-actions`, `merge-modal`
- `users/` — `create-user-form`, `edit-user-form`, `account-actions`, `deactivate-modal`, `impersonate-button`, `role-multi-select`, `user-row-actions`, `customer-import-wizard` (§17)
- `roles/` — `create-role-form`, `edit-role-form`, `permissions-matrix`, `role-row-actions`
- `procurement/` — `status-badge`, `request-form`, `ticket-section`, `decision-buttons`, `procurement-row-actions`
- `settings/` — `branding-form`, `business-hours-form`, `sla-form`, `role-checklist-form` (generic staff-role checklist persisted as a `string[]` setting; backs the SLA warning/breach notify-role pickers, §13), `holidays-list`, `string-list-form`, `scalar-form`, `rate-limit-form`, `save-button`, `taxonomy-table` + `add-taxonomy-button` (shared by the categories and types admin pages; `ticket-type-icon-picker` — a `Popover`-based grid of the 30 curated icons (§5.1) — renders inside both **only when `kind === "type"`**, since categories have no icon column)
- `audit/` — `details-modal`, `load-more`, `presets-bar` (saved filter bookmarks)
- `reports/charts.tsx`
- `dashboard/charts.tsx` — `StatusDonut`, `TrendLineChart`, `PriorityBar` (Recharts) for the admin dashboard
- `moderation/held-message-card.tsx` — one held inbound message + approve-once / approve-and-trust / reject actions (§18)
- `work-logs/` — `add-time-modal`, `timesheet-row-actions` (edit/delete, frozen-history aware), `work-log-fields`, `work-log-table` (DataTable-based)
- `profile/` — `account-form`, `password-form`, `preferences-grid`, `sessions-list`, `mcp-tokens-list` (§23)
- `customer/` — `customer-topbar`, `customer-ticket-list`, `customer-ticket-header`, `customer-message-thread`, `customer-reply-composer`, `guest-reply-composer`, `customer-new-ticket-form`, `customer-profile-form`, `customer-notification-prefs`, `customer-csat-prompt` (§20), `avatar-upload`
- `branding/` — `auth-shell`, `auth-split-shell`, `wordmark`

Conventions: `'use client'` at the top of any component with state, an event handler, or `useEffect`. Shadcn primitives have `eslint-plugin-jsx-a11y/label-has-associated-control` disabled (see `eslint.config.mjs`) since consumers wire labels at the call site. `eslint-plugin-i18next` enforces `t(...)` over literal JSX text for everything outside `components/ui/`.

---

## 11. Design system

The portable SynapseScope spec lives in [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md). It defines:

- Two intentional brand blues: **`#0070C0`** (`--color-brand-chrome`) for navigation chrome and banner gradients, **`#007AFF`** (`--color-brand-action`) for CTAs, focus rings, active markers.
- Roboto across the entire app (loaded via Next/Font in `src/app/layout.tsx` plus the SCSS Google Fonts import in `globals.css`).
- The full token set is encoded as CSS variables in `src/app/globals.css` under `@theme inline` — semantic colors, status/priority maps, radius scale, accessibility body classes (`accessibility-high-contrast`, `accessibility-large-text`, `accessibility-reduce-motion`).
- Ticketing-specific token map (§13 of the design doc):
  - Priority: `urgent #FF1500`, `high #C62828`, `medium #D97706/#FFC70E`, `low #00AAE8/#3395ff`
  - Status: `open #007AFF/#E9EFFF`, `in_progress #489FFF/rgba(72,159,255,0.1)`, `pending #F54040/#FFEBEB`, `resolved #4A9E00/#E4FFE4`, `closed #525252/#EEEEEE`

When you add a new visual surface, reuse these tokens — do not introduce a parallel palette.

---

## 12. Permissions & RBAC

**Source of truth:** `src/lib/auth/permissions.ts` exports the closed `PERMISSIONS` tuple. `role_permissions.permission` rows must match a constant here; code review enforces.

| Domain | Permissions |
|---|---|
| Tickets | `view`, `create`, `update`, `assign`, `reply`, `internal_note`, `resolve`, `resolve_skip_note`, `reopen`, `close`, `escalate`, `deescalate`, `delete`, `merge`, `export` |
| Organizations | `view`, `create`, `update`, `delete` |
| Procurement | `view`, `create`, `update`, `manage`, `export` |
| Reports | `view`, `export` |
| Work log | `view_all` — every technician can view/manage their OWN time entries regardless of permissions; this additionally unlocks seeing EVERYONE's entries (Super Admin only by default) |
| Users | `view`, `create`, `update`, `deactivate`, `reactivate`, `reset_password`, `impersonate`, `unlock` |
| Roles | `view`, `create`, `update`, `delete` |
| Settings | `view`, `update` |
| Audit | `view`, `export` |
| MCP | `connect` — self-service: gates whether a user can mint their OWN Bearer token for the AI agent connector (§23) at all. Doesn't widen what a token can do — every MCP tool call still re-runs the normal `can()` checks — it's purely "who's allowed to connect an assistant" |

> **Meeting-2 changes:** `tickets.assign` is now ticket-scoped in `can()` so the owning Technician can reassign their own ticket; `organizations.*` is a new domain; the four procurement approval/fulfilment permissions collapsed into a single `procurement.manage` (no approval step — the coordinator actions the request through the 4 stages).

> **Follow-up additions:** `tickets.merge` and `worklog.view_all` are not in any seeded per-role array (`IT_DIRECTOR_PERMISSIONS`, `COORDINATOR_PERMISSIONS`, `TECHNICIAN_PERMISSIONS`, `CUSTOMER_PERMISSIONS`) — only Super Admin (which holds `ALL_PERMISSIONS`) has them by default. An admin can grant either to a custom role.

Seeded role defaults (per `permissions.ts`):

- **Super Admin** — every permission
- **IT Director** — read-mostly: ticket view/update/assign/reply/internal_note/deescalate/**close** + organizations.view + reports.view + audit.view + **mcp.connect**
- **Coordinator** — operational: ticket triage incl. resolve_skip_note/**close**; organizations.view/create/update; procurement view/manage; users.view; reports.view + **mcp.connect**
- **Technician** — owns their assigned tickets: ticket view/update/assign(own)/reply/internal_note/resolve/escalate; procurement view/create/update (no `mcp.connect` by default — can be granted via a custom role)
- **Customer** — self-service: ticket view/create/reply (own tickets only via scope checks); procurement view/create

> **`tickets.close`** (added 2026-08-06) is a standalone permission, deliberately not bundled into `tickets.resolve` — IT Director holds `close` without `resolve`. Lets Coordinator/IT Director/Super Admin manually close a **resolved** ticket (`closeTicket`, §9) instead of waiting on the customer's CSAT response or the 24h auto-close cron. Technician and Customer do not get it. See `DECISIONS.md` 2026-08-06.

### 12.1 The `can()` gate

Every privileged Server Action passes through `lib/auth/can.ts` → `can(user, permission, target, productionContext)`. The gate checks:

1. User holds at least one role.
2. User holds the requested permission.
3. Impersonation does NOT block this action. `BLOCKED_DURING_IMPERSONATION` includes `settings.update`, `roles.{create,update,delete}`, `users.{create,deactivate,impersonate}`.
4. Action-specific scope:
   - Ticket actions: strict Technicians can only act on their assignments; strict Customers only on their own tickets; elevated roles see everything.
   - `users.update` / `users.deactivate` / `users.reset_password` enforce self-action rules (you can edit yourself but not deactivate / reset-password yourself; non-Super-Admins must be ancestors via `createdById`; Super Admin bypasses the hierarchy walk).
   - `users.deactivate` refuses the **last active Super Admin**.
   - `users.impersonate` refuses targets who hold Super Admin.
   - `procurement.update` restricts strict requesters to their own request.

`isStrictTechnician`, `isStrictCustomer`, `isStrictRequester` are the helpers; `ticketsVisibilityCondition(user)` returns the SQL WHERE clause for list queries (always excludes `deletedAt IS NOT NULL`).

### 12.2 Account lockout (`lib/auth/lockout.ts`)

5 failed sign-ins in a 15-minute rolling window locks the account for 15 minutes. Storage is Redis primary + `users.locked_until` mirror. The lock clears on successful sign-in or when an admin with `users.unlock` calls `unlockUser`. The first lock fires the `account_lockout` email exactly once.

### 12.3 Sensitive-action re-auth (`lib/auth/reauth.ts`)

Some actions require re-typing the password within the last 5 minutes even when the session is otherwise valid: granting Super Admin role and app-wide setting changes. `verifyReauth` writes a Redis key with TTL; `isReauthFresh(userId)` is the gate. Server Actions return `reauthRequiredResult()` when the gate fails; clients pop the `<ReauthModal>` and retry. Account deactivation and password-reset sends are not currently reauth-gated in this implementation, so their server-action/MCP mirrors follow the same permission checks without a browser-only confirmation step.

### 12.4 Impersonation (`lib/auth/impersonation.ts`)

An admin with `users.impersonate` can act-as another user. The active context lives in an HTTP-only, signed `axiom_imp` cookie carrying `<impersonatorId>|<targetId>` HMAC-SHA256. `getSessionUser` returns the impersonated identity (with `isImpersonating: true`) only when the actual signed-in user matches the impersonator id baked into the cookie. Both start + end are audited; stacking is refused; cookie max-age is 1 hour.

---

## 13. SLA model

- **Pure math** (`lib/sla-compute.ts`): `computeDueAt(createdAt, slaMinutes, respectBusinessHours, config)` walks UTC instants in IANA-tz wall-clock, skipping non-working days and holidays. Two-pass DST correction handles the spring-forward / fall-back hour. The pure module has no DB dependency, so vitest can exercise it without `DATABASE_URL`.
- **DB-backed wrapper** (`lib/sla.ts`): `loadSlaSettings(from, to)` reads settings + the holiday table in one query, `computeDueTimesForNewTicket({ createdAt, priority })` is what every ticket-creation path uses, `recomputeSlaForTicket(id)` re-stamps `responseDueAt` / `resolutionDueAt` and clears the warning columns when priority changes mid-flight (no-op for resolved/closed tickets).
- **Monitor** (`inngest/functions/sla-monitor.ts`): every 20 minutes (widened from an original 5 to keep Neon's free-tier compute idle between runs — SLA windows are hours, so the coarser granularity is immaterial), scans in-flight tickets, marks 50% / 80% / 100% transitions exactly once via `sla_warning_50_at`, `sla_warning_80_at`, `sla_breached_at`. The DB column NULL-check is what makes it idempotent. Tickets with `sla_paused_at` set are skipped entirely.
- **SLA pause** (`setTicketStatus`, `src/app/actions/tickets.ts`): entering `awaiting_customer_confirmation` or `on_hold` stamps `tickets.sla_paused_at = now()`, freezing the clock. Leaving either state shifts `responseDueAt`/`resolutionDueAt` forward by the paused duration and clears the stamp — no separate accumulator column; the shifted due dates ARE the remaining time. `resolved`/`closed`/`draft` can't be entered/exited through this action (use resolve/reopen instead).
- **Notification recipients**: every tier (50% warning, 80% warning, breach) notifies the ticket's assignee automatically (nothing to configure — whoever owns it gets it) PLUS an admin-configurable set of staff roles for that tier, picked via a `<RoleChecklistForm>` checklist on the Settings → Operations tab: `sla.warning_notify_roles` covers both the 50% and 80% warnings, `sla.breach_notify_roles` covers the breach — two independent pickers, both defaulting to Super Admin/IT Director/Coordinator when unset (`DEFAULT_WARNING_ROLES`/`DEFAULT_BREACH_ROLES` in `sla-monitor.ts`). Channels step up with severity: 50% is in-app only, 80% adds SMS, breach adds email on top of both. `sla.breach_repeat_hours` (0 = once) re-nags the breach roles on a cadence while a breached ticket stays unassigned.
- **Holidays** (`lib/db/schema/holidays.ts`): admin-editable list keyed by date; SLA computation honors them for priorities with `respect_business_hours = true`. The seeded defaults treat `critical` as 24/7 (`respect_business_hours = false`) and `high`/`medium`/`low` as business-hours-bound.
- **Fallback targets** live in `lib/sla.ts` (`FALLBACK_TARGETS`) so the monitor never crashes when an admin hasn't set per-priority minutes yet.

---

## 14. Notification pipeline

```
Server Action ── inngest.send('notification/dispatch') ──▶ dispatch-notification ──┐
                                                                                    ├──▶ notification/email ──▶ send-email-notification (Resend)
                                                                                    ├──▶ notification/sms   ──▶ send-sms-notification   (Twilio)
                                                                                    └──▶ notification/in-app ──▶ send-in-app-notification (insert into `notifications`)
```

Producers fire one `notification/dispatch` with a `type: NotificationEventType` and optional `email` / `sms` / `inApp` payloads. The dispatcher resolves recipients from explicit ids + role broadcasts, loads `notification_preferences` per (user, event_type), and gates the email/SMS legs by the user's preferences (defaults: both on). The in-app insert happens whenever the registry has an entry for that event type.

In-app rendering happens at READ time — the DB stores `titleKey`/`bodyKey` + JSON args so the user's current locale wins regardless of when the notification was created.

Bell icon polls `getRecentNotifications` every 30s (RECENT_LIMIT = 20). Old notifications archive after 90 days via the daily cleanup cron.

---

## 15. Billing & support plans

A parallel, accountant-facing pipeline that bypasses the per-user `notification/dispatch` system entirely — it sends straight to a small, globally-configured contact list rather than app users.

1. **Hours are integer minutes** on `organizations`: `monthlyMinutesIncluded` (allotment) + `monthlyMinutesBalance` ("hours remaining"). Only the `monthly_plan` `billable` category deducts. The balance is **read-only** in the org form — it only moves via logged work, the monthly reset, or the admin add-hours action (`addOrganizationHours`, additive-only).
2. **Deduction** — every work-log insert/update/delete calls `syncMonthlyPlanDeduction` (`lib/tickets/billing.ts`) inside the same transaction: it sums the ticket's work-log minutes and applies only the delta versus what was already deducted (`tickets.monthly_plan_deducted_minutes`), so it's safe to call after any change that affects the figure.
3. **Monthly reset** — `monthly-plan-reset` (daily cron `0 6 * * *`) resets each Monthly-Plan org's balance to its included minutes at most once per UTC calendar month (`monthly_plan_reset_at` guard), no rollover.
4. **Usage breakdown** — `getOrganizationUsage` aggregates `work_logs.minutes` by UTC month × `billable` category, rendered on the org detail page; `lib/billing/plan-watch.ts` also surfaces a proactive internal watchlist of orgs that are over-plan or under 20% remaining.
5. **Accountants are a global settings-configured contact list** (`billing.accountant_emails` / `billing.accountant_phones`), NOT app users and NOT per-organization; `billing.superadmin_receive_copy` additionally CCs active Super Admins. Resolved by `getAccountantRecipients()` (`lib/billing/accountants.ts`).
6. **Over-plan alert** (email + SMS) — every `syncMonthlyPlanDeduction` caller emits `billing/balance.changed` **after** the transaction commits (never inside it, or the monitor would read a stale balance). `billing-balance-monitor` atomically claims the alert on `organizations.negative_balance_alerted_at` so each negative episode alerts exactly once, and clears the flag on recovery.
7. **Resolved-ticket billing summary** (email only) — `resolveTicket` emits `billing/ticket.resolved`; `notify-accountant-resolved` derives an outcome (`deriveBillingOutcome`, pure, tested — monthly-within-plan → billed; over-plan → pending; project/yes → pending; no/rework → none; null or monthly-on-non-plan-org → review) and emails accountants. `none` is skipped to avoid noise.

Templates: `accountant_negative_balance` (email + SMS), `accountant_ticket_billing` (email only). See `DECISIONS.md` and migration `0016`.

---

## 16. Export (CSV / XLSX / PDF)

A single shared pipeline (`src/lib/export/`) backs every export surface in the app — tickets, organizations, roles, users, procurement, audit, and reports.

- `dataset.ts` defines the format-agnostic `ExportDataset`/`Section` shape every consumer builds; `respond.ts` (`exportResponse(dataset, format, filenameBase)`) is the one function every `.../export/route.ts` calls.
- `csv.ts` — hand-rolled, with CSV-formula-injection escaping and a BOM for Excel.
- `xlsx.ts` — via `exceljs`: a Summary sheet plus one sheet per table/section.
- `pdf.ts` — via `pdfkit`: branded (pulls logo/accent from settings via `branding-assets.ts`), multi-page, paginated tables.
- The `<ExportMenu>` component (`components/shared/export-menu.tsx`) is the one dropdown UI, linking to `?format=csv|xlsx|pdf` on the relevant API route.
- `audit/export` is the one exception: its CSV leg still streams an unbounded `ReadableStream` directly (so large audit exports don't need to fit in memory); its XLSX/PDF legs go through the shared pipeline like everything else.
- Row caps exist where a full table scan would be unbounded: `tickets/export` (5000), `users/export` (10000).

---

## 17. Customer import

A wizard at `/admin/users/import` (`users.create`) for bulk-onboarding customers from a CSV, backed by `src/lib/customer-import/` + `src/app/actions/customer-import.ts`.

1. Admin pastes or uploads a CSV/TSV of customers (name, email, phone) — up to 500 rows.
2. `previewCustomerImport` validates each row (zod) and flags `duplicate_in_file`, `duplicate_existing_customer`, `duplicate_existing_staff`, and `invalid` rows. It also resolves each row's email domain against known organizations (`resolveDomainsForImport`); free-mail domains (gmail, outlook, …) never suggest creating an org. Domains that don't match an existing org are grouped into `unmatchedDomains`, and the admin decides per-domain: create a new org (with a suggested name + abbreviation), assign to an existing org, or skip.
3. The admin reviews/edits the preview client-side, then confirms.
4. `commitCustomerImport` **re-validates everything server-side** (never trusts the client preview), synchronously creates any admin-approved new organizations, then fires a single `customer-import/batch.requested` Inngest event.
5. `process-customer-import-batch` provisions every row via the same `users/provision.ts` core `createUser` uses, and each new customer gets the customer-invite email (§22) — kept out of the request/response cycle so a large file can't time out the admin's browser.

---

## 18. Inbound email pipeline

1. Resend POSTs to `/api/email/inbound`.
2. Route verifies Svix signature against `RESEND_WEBHOOK_SECRET`.
3. Route rate-limits 1000/min by IP (after signature check so attackers can't drain the budget with junk).
4. Route deduplicates via `processed_webhook_events(provider='resend', event_id=<svix-id>)`.
5. Route normalizes via `normalizeResendInbound`, emits `email/inbound.received`.
6. Resend's inbound webhook payload is **metadata-only** (no `text`/`html`/`headers`) — `lib/email/fetch-inbound.ts` fetches the full content via `GET /emails/receiving/{id}` and merges it in before normalizing; a fetch failure rolls back the idempotency row so Resend retries.
7. `process-inbound-email` runs the decision tree:
   - `shouldAcceptInbound` drops auto-submitted / vacation-responders / bounces / list-mail / precedence-bulk / empty-after-strip.
   - `extractTicketNumber` looks at the `ticket+AX-XXXX@<domain>` sub-address, then `[AX-XXXX]` in subject, then `In-Reply-To`/`References` headers, then `ticket_email_refs` (`resolveTicketByMessageRefs` / `resolveTicketBySubjectSender` — a second threading signal captured from prior RFC `Message-ID`s, migration `0028`).
   - Missing ticket number → call `createTicketFromInbound` (honors `inbound_sender_allowlist_only`, strips `Re:`/`Fwd:`, defaults category/priority; resolves the org via `resolveTicketOrgForGuest`, stamping `org_match_status` and, when the sender resolves to a known **staff** account rather than an external customer, `customer_attribution_unverified = true` — surfaced as a "confirm the customer" banner on the ticket detail page).
   - Ticket not found → send `inbound_bounce` reply.
   - Ticket closed → send `inbound_closed_ticket` reply.
   - Loop detection: >5 messages from the same sender on the same ticket in 5 minutes → drop with a `loop-detected` log line.
   - **Sender classification** (`classifyInboundSender`) → `customer` / `participant` / `org-domain` / `org-trusted` (moderator-approved-and-trusted) / `foreign`. Recognized senders auto-post; `foreign` is held for moderation (`messages.moderation_status = 'held'`) whenever `inbound_moderation_enabled` is true (default) — excluded from every thread render until a Coordinator (or the assignee, or Super Admin) approves it from `/admin/moderation`: **approve once** (posts, sender stays moderated), **approve & trust** (posts + adds the sender to `organization_trusted_emails` org-wide, or as a `ticket_participants` row for a guest ticket), or **reject**.
   - Anti-spoofing: auto-post relations additionally require a passing `senderAuthVerdict` (DMARC-aligned, or aligned DKIM/SPF, from `lib/email/auth-results.ts`) — a failing/missing result downgrades to `foreign` and gets held. Relax via the `inbound_require_auth` setting (default true).
   - Otherwise: insert the customer message (after quote/signature strip), ingest attachments (mailparser → MIME + size + magic-byte filter → R2 upload → `attachment/uploaded` event), touch `tickets.updated_at`, dispatch `ticket.customer_replied` to the assigned tech.

Reply-To routing: outbound emails with `replyToTicket: true` set `Reply-To: ticket+AX-XXXX@<inbound_email_domain>` so the customer's reply lands back on the same ticket.

---

## 19. Attachment pipeline

1. Client requests `generateUploadUrl({ ticketId, fileName, mimeType, sizeBytes })`. The action validates MIME (against `lib/storage/mime.ts` allowlist) + size, calls `can('tickets.reply', ticket)`, inserts a pending `attachments` row, mints a presigned PUT URL (`storage/upload.ts`), returns it.
2. Client `PUT`s the bytes directly to R2.
3. Client calls `confirmUpload({ attachmentId })`. The action HEADs R2 to verify the object exists, range-reads the first 16 bytes, verifies the magic bytes match the declared MIME (`storage/magic-bytes.ts`). If they don't, the row flips to `quarantined` and the object is deleted; if they do, the row flips to `pending` with `uploadConfirmedAt` set, and the action emits `attachment/uploaded`.
4. `scan-attachment` Inngest function fetches the bytes from R2, runs them through the configured provider (`disabled` / `eicar` / `clamav-rest`), and either marks `clean` or flips to `quarantined` + deletes the R2 object + dispatches `attachment.quarantined` to the uploader and the assigned tech.
5. `getDownloadUrl` mints a 5-minute signed GET URL with `Content-Disposition: attachment` for risky types (PDF/zip), inline for others. It blocks strict customers from downloading attachments whose parent message has `is_internal_note = true` — even when they own the ticket (see DECISIONS.md 2026-05-10).

Storage keys: `<env>/<ticketId>/<attachmentId>/<sanitizedFilename>` for attachments, `<env>/avatars/<userId>/<timestamp>.<ext>` for profile pictures. Avatar signed URLs have a 1-hour TTL (vs. 5 minutes elsewhere) so the browser can cache them across pages; the timestamp suffix guarantees a fresh avatar produces a new key.

---

## 20. CSAT flow

CSAT is a **3-way emoji rating** (`ticket_reviews`, migration `0023`) — happy (😊) / neutral (😐) / unhappy (☹️) — that replaced the original 2-button satisfied/unsatisfied flow at the UI layer. The legacy `tickets.csat_response` column is kept in lock-step underneath (`ratingToResponse`: happy+neutral → `satisfied`, unhappy → `unsatisfied`) so the old close/reopen state machine and any binary reporting keep working unmodified; `tickets.csat_rating` holds the latest 3-point value, but `ticket_reviews` — one append-only row per rating event — is the source of truth for CSAT reporting (§7, `reports/queries.ts`) and the only place per-technician / per-organization / monthly-trend stats and free-text comments live.

1. Agent resolves a ticket → `resolveTicket` inserts a customer-visible resolution note (or, on the skip-note coordinator path, an internal note explaining why), then **dispatches `ticket.resolved` through Inngest** (email + SMS + in-app, gated per the customer's per-event preferences). The email links to the hosted `/csat` page with the rating pre-selectable; the in-app row deep-links to the ticket detail page.
2. The customer has two paths to give feedback — same write path (`recordCsatResponse` in `lib/tickets/csat-apply.ts`) either way:
   - **From email:** click through to `/csat` (`CsatLandingForm`), pick happy/neutral/unhappy. The older one-click `GET /csat/confirm?t=…&tk=…` route (`verifyCsatToken` HMAC check) still exists for links already sent out — it now redirects into `/csat` with the rating pre-filled rather than mutating state itself.
   - **From the portal:** open the ticket detail page while it's `resolved` → `<CustomerCsatPrompt>` shows the three emoji → picking **unhappy reveals a mandatory comment** (happy/neutral leave it optional) → `submitCsatFromPortal(ticketId, rating, comment?)` verifies ownership (`customer_id === user.id`) without a token. The comment is posted as a customer-authored `messages` row on the thread so the assigned tech sees it in context, and also stored on the `ticket_reviews` row.
3. Either path branches the same way:
   - Already responded → recap banner (portal) / `/csat/result?status=already` (email).
   - Already moved past resolved (e.g. a new agent reply reopened the ticket) → record the response on the row but don't roll status back.
   - Happy or neutral + still resolved → close the ticket, send `ticket_closed`.
   - Unhappy + still resolved → reopen (back to `in_progress` if still assigned, else `open`), bump `reopened_count`, send `ticket_reopened` to the customer and **dispatch `ticket.csat_unsatisfied`** to the assigned tech + every active Coordinator (email + SMS + bell, gated per the recipient's prefs).
4. After 24h with no response on either path, `auto-close-resolved-tickets` closes the ticket with `reason: csat_no_response_24h` and sends `ticket_closed`.

**Staff-initiated close (added 2026-08-06)** — Coordinator, IT Director, and Super Admin (`tickets.close`, §12) can also close a `resolved` ticket directly via `closeTicket` (§9), without waiting on the customer or the cron. It reuses the same `ticket_closed` customer notification and `dispatchTicketClosedStaff` oversight alert as the two paths above, tagged `reason: "staff"`. The "Close ticket" button sits next to Reopen on the ticket detail page once a ticket is resolved. Technician and Customer cannot do this — only the CSAT/auto-close paths remain available to them (indirectly, in the customer's case).

**Backfill** — `tickets.csat_rating` (and the historical `ticket_reviews` rows) for pre-existing responses were backfilled from the old binary `csat_response` (satisfied→happy, unsatisfied→unhappy — neutral can't be recovered retroactively) by both migration `0023` and the standalone idempotent script `src/lib/db/add-csat-reviews.ts` (`pnpm db:add-csat-reviews`) — the latter exists as a workaround for when the Neon console SQL editor is blocked by free-tier compute limits.

**Email "view your ticket" routing** — every outbound email link is built via `lib/tokens.ts:ticketTrackingUrl({appUrl, ticketNumber, customerEmail, customerId})`. When `customerId` is set, the URL goes to `/portal/tickets/<num>` (authenticated portal); when null (guest), it falls back to the HMAC-signed `/portal/guest/tickets/<num>?token=…` URL. Used by `assignTicket`, `replyToTicket`, `resolveTicket`, `reopenTicket`, the `/csat` page, and the inbound-email confirmation. The legacy `guestTicketUrl` remains for `createTicket` / `createTicketOnBehalf` where the customer's account linkage isn't known at send time.

**Guest tickets** (no `customer_id`) take a slightly different path: no in-portal prompt (they don't have a portal account), `resolveTicket` falls back to a direct `sendEmail` for the resolution email (no preferences row to consult, no SMS phone, no bell inbox). The email-link CSAT path still works exactly the same for them.

---

## 21. Public ticket submission

`/portal/submit` → `submission-form.tsx` → `createTicket` Server Action. Layered defenses:

1. zod validation (name 1–120, email, subject 3–150, description 20–5000; `category` validated against the currently-active `ticket_categories` rows rather than a fixed enum, §5.1). **Priority is not asked of the customer** — schema defaults to `medium`, Coordinator triages on review.
2. Honeypot field — if a bot fills it, the action returns a success-shaped result with `ticketNumber: "AX-XXXX"` to discourage retries.
3. IP rate limit (`publicSubmitByIp`, 5/hour) and email rate limit (`publicSubmitByEmail`, 20/day) — both checked before Turnstile to avoid burning the captcha budget.
4. Cloudflare Turnstile (`verifyTurnstile`) — required in production, skipped in dev with a warning when no secret is set.
5. Stream classification via `classifyStream(email)` — staff role membership wins, otherwise the `internal_email_domains` allowlist decides.
6. SLA deadlines computed at insert time from the ticket's priority.
7. Insert ticket + initial `messages` row inside a single `transactional`.
8. Audit (`actorId: null` so the row is attributed to a public submission).
9. Best-effort confirmation email with a guest tracking URL (`guestTicketUrl`) — failures don't roll the ticket back.

---

## 22. Auth flows

### 22.1 Admin / staff sign-in

- **Form path:** `signInWithLockout(email, password)` Server Action wraps `auth.api.signInEmail` with the per-account lockout described in §12.2. On success Better Auth's `nextCookies()` plugin (registered in `lib/auth/index.ts`) sets the session cookie via Next.js `cookies()`.
- **Session lifetime:** absolute 7 days (`session.expiresIn`), `updateAge` 5 minutes (cookie is refreshed on each window of activity). The admin gated layout independently enforces a 12-hour idle timeout by reading `session.session.updatedAt`.
- **First-time staff setup:** when an admin creates a STAFF user, the system fires Better Auth's `requestPasswordReset` flow, which sends `staff_setup_invite` (copy varies based on whether `users.lastLoginAt` is null) pointing at `/admin/setup?token=…&email=…`. The setup form sets the password via `auth.api.resetPassword` and then immediately signs the user in via `auth.api.signInEmail` with that same email + password — so the user lands on `/admin` on the first submit click. If the auto-sign-in fails (e.g. account locked), the form falls back to `/admin/login?reset=ok` and the user signs in manually.

### 22.2 Customer auth

- **Primary:** magic-link via Better Auth's `magicLink` plugin (`expiresIn: 600s`, `rateLimit: 3/email/hour`). On verification, `databaseHooks.user.create.after` runs `assignCustomerRole` + `claimTicketsForCustomer`.
- **Fallback:** password (Better Auth `emailAndPassword`, min 12 chars).
- **Guest:** signed-URL ticket view + reply with no account, gated by `verifyGuestToken` + per-ticket and per-IP rate limits.
- **Admin-provisioned invite (`createUser`'s Customer branch, and the customer-import batch, §17):** uses its own HMAC token (`signCustomerInviteToken`, `lib/tokens.ts`) and its own `customer_invite.expiry_hours` setting (default 72h) — separate from staff's Better Auth reset-token flow. `sendCustomerSetupInvite` (`lib/customer/invite.ts`) refreshes `users.invitedAt`/`inviteExpiresAt` from the LIVE setting on every (re)send. `acceptCustomerInvite` (`src/app/actions/customer-invite.ts`) consumes the token to set a password and sign the customer in. `computeInviteStatus` (`lib/users/invite-status.ts`) derives `active`/`invited`/`invite_expired` for the admin Users list from the three timestamp columns — there's no stored status column.

### 22.3 Passkeys

The `passkeys` table is migrated and Better Auth's passkey plugin is wired through Drizzle, but no UI surface exposes them yet — they're a forward placeholder.

---

## 23. MCP server (AI agent access)

`src/app/api/mcp/route.ts` exposes a [Model Context Protocol](https://modelcontextprotocol.io) server (`@modelcontextprotocol/sdk`) so an AI agent (e.g. Claude) can be pointed at the ticketing system directly, authenticated as a specific user rather than through the browser session. What shipped initially (read tools + a single internal-note write tool) was expanded in the same feature arc into a near-complete write surface mirroring the admin panel's Server Actions — see the design principles below before assuming a tool is "just a read tool."

### 23.1 Connecting

1. A user mints a Bearer token from their own `/admin/profile`, but only if they hold **`mcp.connect`** (`createMyMcpToken`, prefix `axmcp_…`, shown once, revocable). `mcp.connect` is seeded by default to **Super Admin, IT Director, and Coordinator only** — Technician and Customer don't get it (an admin can grant it to a custom role). Tokens are stored SHA-256-hashed in `mcp_tokens` (migration `0030`); the permission itself was backfilled onto existing roles by migration `0031` / `pnpm db:add-mcp-connect-permission`, since `pnpm db:seed` is a no-op once roles already exist.
2. Every request to `/api/mcp` presents the token as `Authorization: Bearer axmcp_…`. `resolveMcpToken` (`lib/auth/mcp-tokens.ts`) hashes it, looks it up (`revoked_at IS NULL`), **re-checks `mcp.connect` on every single call**, and rebuilds a full `SessionUser` from the DB — so a role change or a revoked `mcp.connect` grant takes effect on the very next tool call, not just the next login. Every tool call additionally re-runs `can()` (and, for ticket tools, the same scope rules as the browser session — a strict Technician only ever touches their own assignments through MCP too).
3. `lib/mcp/server.ts` (`buildMcpServer`) registers the 8 base read tools + `add_ticket_note`, then delegates to eight `register*WriteTools` functions, one per domain module under `lib/mcp/`.

### 23.2 Design principles (the write surface)

- **Every write tool mirrors an existing Server Action, not a new code path.** Each `lib/mcp/*-write.ts` module has a `*ViaMcp` function ported from the Server Action it mirrors (the file-top comment names the exact source function + line range), reusing the same `can()` checks, business-rule guards, and audit/notification side effects — just adapted to take an explicit `SessionUser` (no cookies/`headers()` available over a Bearer token) and to resolve entities by a human-readable identifier (email, name, ticket number) instead of a uuid, since that's what a chat conversation naturally supplies.
- **MCP can do LESS than the UI, never more.** The browser-only reauth-sensitive actions that are refused over MCP are granting/keeping the **Super Admin** role via `create_user`/`update_user` (refused outright with a message pointing at the admin panel) and `update_setting` (it tells the caller which Settings page to use instead of mutating anything). `deactivate_user` and `reset_user_password` are also exposed as MCP tools, but they do not add a separate browser re-auth gate beyond the normal `can()` permission checks in their mirrored actions. This isn't a workaround of re-auth, it's the same control applied more strictly where the UI requires it.
- **"Can't grant what you don't have" is shared, not reimplemented.** `permissionsBeyondCaller()` (`lib/auth/permission-diff.ts`) was extracted out of `app/actions/users.ts` specifically so `create_role`/`update_role`/`create_user`/`update_user` (both the admin actions and their MCP mirrors) enforce the exact same "you can't grant a permission you don't hold yourself" rule from one implementation.
- **Every mutating tool's description embeds a confirm-first instruction** ("show the user exactly what will change and get their explicit go-ahead in the chat first — never call this on the first ask"), since there's no separate UI confirmation dialog the way there is in the admin panel. `reply_to_ticket` and `resolve_ticket`'s wording is the most emphatic, since those are customer-visible.
- **Destructive/hard operations keep their original guardrails**: `delete_organization` refuses while any ticket or user references the org (deactivate instead); `delete_ticket_category`/`delete_ticket_type` refuse the default entry or one still in use by a ticket; `delete_role` refuses a system role or one still assigned to anyone; `merge_tickets` still requires same-organization tickets and a non-terminal target status.

### 23.3 Tool catalog

Read-only (`lib/mcp/queries.ts` + `audit-write.ts`, despite the filename): `get_ticket`, `list_tickets_by_status`, `list_overdue_tickets`, `list_unassigned_tickets`, `list_escalated_tickets`, `get_ticket_stats`, `get_customer_or_org_history`, `get_procurement_status`, `summarize_audit_log` (free-text/date/actor/outcome filters, same strict-technician own-entries-only scoping as `/admin/audit`, §7.1/§24).

| Module | Write tools |
|---|---|
| `tickets-write.ts` | `create_ticket` (the "create on behalf" flow), `assign_ticket`, `delete_ticket` (soft), `merge_tickets`, `reply_to_ticket` (**customer-visible** — emailed/SMS'd/in-app), `resolve_ticket`, `reopen_ticket`, `set_ticket_status` (open/in_progress/awaiting_customer_confirmation/on_hold, SLA-pause math preserved), `set_ticket_priority` (recomputes SLA), `set_ticket_category`, `set_ticket_type`, `escalate_ticket`, `deescalate_ticket`, plus `add_ticket_note` on `server.ts` (internal-only, never a customer reply). **No `close_ticket` tool yet** — `tickets.close`/`closeTicket` (§9, §20) landed in a later commit than this write surface and hasn't been wired into MCP. |
| `users-write.ts` | `create_user`, `update_user`, `deactivate_user` (cascade: move-up / cascade / reassign), `reactivate_user`, `unlock_user`, `reset_user_password`. Cannot grant Super Admin (§23.2); no separate MCP refusal for deactivation/reset beyond standard permission checks. |
| `roles-write.ts` | `create_role`, `update_role`, `delete_role`. |
| `organizations-write.ts` | `create_organization`, `update_organization`, `add_organization_hours` (additive-only monthly-plan top-up, §15), `delete_organization`. Shares validation helpers (`lib/organizations/validation.ts`) with the admin Server Action. |
| `procurement-write.ts` | `create_procurement_request` (notifies Coordinators), `set_procurement_status` (4-stage pipeline, §5.1). |
| `settings-write.ts` | `add_holiday` / `remove_holiday` (no re-auth needed, fully usable), `update_setting` (refusal-only, see §23.2), `update_my_notification_preference` / `enable_all_my_notifications` (self-scoped to the connected user only). |
| `categories-types-write.ts` | `create_ticket_category` / `rename_ticket_category` / `set_ticket_category_active` / `set_default_ticket_category` / `delete_ticket_category`, and the same 5 for ticket **types**. `create_ticket_type`/`rename_ticket_type` additionally take an optional `icon` (`z.enum` of the 30 keys, §5.1) — omitted, it's auto-suggested from the label since there's no picker over MCP. Reordering is UI-only, skipped here. |

---

## 24. Audit log

Every privileged Server Action calls `audit({...})` after a successful state change. Conventions:

- `action` follows `domain.verb` (`ticket.assign`, `user.deactivate`, `procurement.approve`, …).
- `targetType` + `targetId` identify the row (use the human-readable `ticketNumber` for tickets, UUIDs elsewhere).
- `before` / `after` are JSON snapshots of only the fields that changed.
- Failures (auth / validation) are NOT audited — they're logged with `console.warn` / `console.error`.
- Impersonation: callers don't plumb `impersonatorId` through. `audit()` auto-detects an active impersonation cookie and stamps the real admin's id; explicit overrides win.
- Database role grants restrict UPDATE/DELETE on `audit_log` (applied as a custom step in migration `0000`, hardened further in `0021`). Anyone with write access to Postgres can still alter the grants, so the table is hardened against the application, not against an admin with a psql shell.
- `target_label` (added alongside `0021`) is a best-effort human label (`targetLabelSnapshot()`, `lib/audit.ts`) resolved at write time when a caller doesn't pass one explicitly, so a row referencing a renamed or hard-deleted entity stays legible instead of showing a bare id.
- `/api/audit/export` streams CSV chunks via `iterAuditEntries` (no full materialization); XLSX/PDF route through the shared export pipeline (§16).
- **Saved filter presets** (`audit_filter_presets`, migration `0029`) let any user with `audit.view` name and reload a filter combination (raw query string) from the `<AuditPresetsBar>` — shared across users, not personal.

---

## 25. Settings

| Source | Purpose |
|---|---|
| `lib/settings-registry.ts` | Zod schema map for every writeable key + `READ_ONLY_AFTER_FIRST_SET` (currently just `inbound_email_domain`) |
| `lib/settings.ts` | `getSetting<T>(key)`, `getSettings<T>([k1, k2, ...])` readers |
| `lib/db/seed.ts` (DEFAULT_SETTINGS) | The full seeded list |
| `app/(admin)/admin/(gated)/settings/page.tsx` + `components/settings/*-form.tsx` | UI |

Categories:
- **Business hours:** timezone, start/end hour, working days, holidays (separate table)
- **SLA:** `sla.<priority>.{response_minutes, resolve_minutes, respect_business_hours}` for each of critical / high / medium / low (time minutes seeded as null — admin sets them via Settings before the monitor is meaningful); `sla.warning_notify_roles` (50%/80% recipients) and `sla.breach_notify_roles` + `sla.breach_repeat_hours` (breach recipients + re-nag cadence) are two independent `<RoleChecklistForm>` role pickers, both defaulting to Super Admin/IT Director/Coordinator (§13)
- **Email + stream:** `internal_email_domains`, `support_email`, `inbound_email_domain`, `inbound_sender_allowlist_only`, `inbound_require_auth`, `inbound_moderation_enabled` (§18), `default_sender_name`, `default_sender_email`, `customer_response_window_hours`
- **Procurement:** `procurement_approval_threshold` (0 = single-step coordinator only; positive = two-step Coordinator + Super Admin above the threshold)
- **Billing (§15):** `billing.accountant_emails`, `billing.accountant_phones`, `billing.superadmin_receive_copy` — its own "Billing" settings tab
- **Ticket lifecycle monitors:** `unassigned_alert.{enabled, threshold_minutes, repeat_minutes}`, `customer_followup.{followup_days, close_days}`
- **Customer invites (§22):** `customer_invite.expiry_hours` (default 72)
- **Rate limits:** `rate_limits.{public_submit, login, password_reset, guest_portal, authenticated.*}` — separate keys for each authenticated bucket
- **File uploads:** `file_upload.max_size_bytes`, `file_upload.allowed_mime_types`
- **Virus scanning:** `virus_scan.{enabled, provider, endpoint}` — provider is `disabled` | `eicar` | `clamav-rest`
- **Branding:** atomic `branding` object (`brandName`, `brandAccent`, `accentColor`, `gradientPreset`) — must move together

`updateSetting` requires re-auth freshness, audits before/after, and `revalidatePath`s any pages that read the changed key. Ticket categories and types (§5.1) are admin-managed but live in their own tables/pages (`/admin/categories`, `/admin/types`), not in this key/value store.

---

## 26. i18n

- `next-intl` v4 with the request config at `src/lib/i18n.ts` (registered from `next.config.ts` via the plugin).
- Locales: English only at MVP (`SUPPORTED_LOCALES = ['en']`). Adding a locale = drop a `messages/<locale>.json` and append to the tuple.
- `pickLocale(...candidates)` resolves the first supported value from a list — used by email senders (`users.language` → `recipient.locale` → default) and by the request resolver.
- Outbound surfaces:
  - Email subjects pull from `emails.<template>.subject` (with placeholder values automatically derived from the template props).
  - Email bodies are React Email components that internally call `getTranslations` against their template namespace.
  - SMS bodies render via the namespace map in `lib/sms/send.tsx`.
  - In-app notifications store i18n keys + arg JSON; rendered at read time.
- ESLint enforcement (`eslint-config-next` + `eslint-plugin-i18next` in strict `jsx-text-only` mode) catches literal JSX text outside `components/ui/`. The plugin's word allowlist permits numbers, symbols (`·`, `—`, `…`), keyboard glyphs (`⌘…`, `⌥`, `⇧`, `⏎`), and the `current/max` counter pattern.

---

## 27. Accessibility

Per `DECISIONS.md` 2026-05-08, target is **WCAG 2.1 AA**, enforced in three layers:

1. **Lint:** `eslint-plugin-jsx-a11y` strict rules (alt-text, label-has-associated-control, role-has-required-aria-props, etc.). Exceptions: `components/ui/` (shadcn primitives) has `label-has-associated-control` off; consumers wire labels at call sites.
2. **E2E:** `@axe-core/playwright` runs against key routes in `e2e/a11y.spec.ts`. `color-contrast` is temporarily disabled in CI (flickers under dark-mode media-query handling); manual audit is on the carryover list.
3. **Markup:** the gated admin layout AND the public layout both render a `<SkipLink>` targeting `<main id="main-content">`. The shared `Table` primitive defaults to `<th scope="col">`. The permissions matrix uses native `<details>`/`<summary>` for module accordions (browser owns the open/closed state — no React state to go stale) and native `<input type="checkbox">` + `<label>` for grants; the hierarchy tree is recursive `<ul><li>` so screen readers announce them as standard controls.
4. **Body classes:** `accessibility-high-contrast` (`filter: contrast(1.4)`), `accessibility-large-text` (`zoom: 1.15`), `accessibility-reduce-motion` (kills animations/transitions/smooth-scroll).

---

## 28. Security headers + posture

`next.config.ts` applies on every path:

```
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

Other notable posture:

- **CSRF:** Better Auth's `trustedOrigins` is configured per environment. In production it's `NEXT_PUBLIC_APP_URL` + `BETTER_AUTH_URL`. In dev we also trust localhost:3000–3003.
- **Webhook verification:** Resend (Svix) and Twilio signatures are verified before any state change. Idempotency via `processed_webhook_events`.
- **HMAC tokens:** all guest URLs (`guestTicketUrl`), CSAT tokens, the customer-invite token, and impersonation cookies are HMAC-SHA256 signed with `crypto.timingSafeEqual` verification.
- **Sanitization:** every message HTML body goes through `sanitizeMessageHtml` before storage; `<a>` is force-rewritten to `target="_blank" rel="noopener noreferrer"` and `javascript:`/`data:` URIs are blocked.
- **File uploads:** MIME allowlist + magic-byte verification + per-file size cap + filename sanitizer + optional virus scan + force `Content-Disposition: attachment` for browser-renderable risky types (PDF, zip).
- **MCP tokens (§23):** a separate, self-service Bearer-token auth surface alongside the session cookie. Stored SHA-256-hashed (never plaintext), revocable, and every call is re-authorized through the same `can()`/visibility gates as the session-based path — a token is exactly as powerful as the user who minted it, no more.
- **No 2FA at present** — password + lockout + per-action re-auth covers the threat model. The Better Auth twoFactor plugin can be re-added later.

---

## 29. Scripts

| Script | Action |
|---|---|
| `pnpm dev` | Next dev server |
| `pnpm build` | Production build (`next build`) |
| `pnpm start` | Production server (`next start`) |
| `pnpm lint` | ESLint over the whole repo |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest unit tests |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm test:e2e` | Playwright; boots Next on port 3100 unless `PLAYWRIGHT_BASE_URL` is set |
| `pnpm db:generate` | drizzle-kit generate (schema diff → SQL migration) |
| `pnpm db:migrate` | drizzle-kit migrate (apply SQL migrations) |
| `pnpm db:push` | drizzle-kit push (direct sync; dev only) |
| `pnpm db:studio` | drizzle-kit studio (web UI) |
| `pnpm db:seed` | Seed roles + permissions + default settings |
| `pnpm db:seed-super-admin` | Create first Super Admin via Better Auth |
| `pnpm db:seed-demo` | Seed realistic demo data |
| `pnpm db:backfill-customers` | Bulk-link legacy customer-less tickets to existing Customer accounts |
| `pnpm db:add-csat-reviews` | Idempotent standalone provisioning + backfill of the `ticket_reviews` CSAT schema (§20) — workaround for when the Neon console SQL editor is blocked by free-tier compute limits |
| `pnpm db:add-ticket-type-icon` | Idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for `ticket_types.icon` (§5.1) |

> This table isn't fully exhaustive — several other idempotent `db:add-*`/`db:backfill-*` scripts exist for one-off production column additions and data backfills; see `package.json`'s `scripts` block for the complete, current list.

---

## 30. Conventions

- **Server boundaries:** every privileged write is a Server Action under `src/app/actions/`. API route handlers are reserved for webhooks (Resend, Twilio, Inngest), Better Auth's catch-all, and streamed exports. Server Components do the read-side rendering directly via Drizzle.
- **`"use server"` files:** Next.js 16 forbids non-async-function exports — keep zod schemas, types, and helper objects module-private. Re-export types from a sibling non-`"use server"` file if a client needs them.
- **Permission gating:** always pass through `can(user, permission, target, productionContext)`. Never short-circuit with a role-name check unless the helper (`isStrictTechnician`, etc.) is the right tool.
- **Audit before revalidate:** audit FIRST, then `revalidatePath`. A failed audit insert should not silently mask a write — let the action throw and re-run.
- **DB writes:** prefer `transactional` for any operation that touches >1 table or needs read-modify-write atomicity (assignment status flips, merge, soft-delete cascades).
- **Email sending:** always `try/catch` around `sendEmail`. The underlying state change (resolution, assignment, ...) must not roll back when Resend hiccups; the audit row is enough breadcrumb for follow-up.
- **Rate limits:** every user-controlled write that goes through a Server Action should call `enforceUserRateLimit('<bucket>', user.id)`. The bucket list lives in `lib/ratelimit.ts`.
- **Tailwind utilities:** prefer the brand tokens defined in `globals.css` (`bg-brand-action`, `text-status-resolved-fg`, …) over raw hex. Do not introduce a parallel color scale.
- **Commits per agent task:** the SynapseScope spec mentions "small commits per step" — that posture applies here too.
- **Do not invent values.** If a token, permission, status, or setting is missing, surface it rather than guessing.

---

## 31. Decision log

Architectural decisions that aren't obvious from reading the code live in [`DECISIONS.md`](./DECISIONS.md), newest first. Examples currently captured:

- **2026-08-13 — Ticket-type sidebar icons are admin-chosen, not computed:** replaced the original position-based 8-icon rotation with a real `ticket_types.icon` column (§5.1), picked by the admin (pre-suggested from the label by keyword match, always overridable) via a new `Popover`-based picker — the vocabulary and full rationale (including a `react-hooks/static-components` lint gotcha worth remembering) live in `DECISIONS.md`.
- **2026-08-08 — MCP write-tool surface + `mcp.connect` permission:** the MCP connector (§23) grew from 8 read tools + one internal-note write tool to ~53 tools total. New `mcp.connect` permission (seeded to Super Admin/IT Director/Coordinator, migration `0031`) gates who can mint their own Bearer token — re-checked on every request, not just at mint time. Every write tool mirrors an existing Server Action's `can()` checks and business rules verbatim; the browser-only reauth-sensitive actions that are refused over MCP are Super Admin grants and any `settings.update`, while `deactivate_user`/`reset_user_password` do not add a separate MCP-only reauth gate because the server-action implementation likewise does not require one. `tickets.close` has no MCP tool yet — it landed two days earlier.
- **2026-08-06 — Staff-initiated ticket close (`tickets.close`):** standalone permission (not folded into `tickets.resolve`) so IT Director can close a resolved ticket without holding resolve; granted by default to Coordinator/IT Director/Super Admin. `closeTicket` only accepts a `resolved` source status and reuses the existing `ticket_closed` customer notification + staff oversight dispatch, tagged `reason: "staff"`.
- **2026-05-21 — CSAT-unsatisfied captures comment + notifies tech & Coordinator; email links route by account state:** "No, still not fixed" prompt now reveals a textarea (optional comment) before reopening; comment is inserted as a customer-authored `messages` row so the tech sees the context. New `ticket.csat_unsatisfied` dispatch event (email + SMS + bell) targets the assigned tech + every active Coordinator, fired from both CSAT entry points (portal action and email-link route). New `ticketTrackingUrl(opts)` helper picks between `/portal/tickets/<num>` (authed) and the guest token URL (no `customer_id`); every lifecycle email producer now routes through it.
- **2026-05-21 — Every customer-facing ticket update goes through dispatch:** assigned / agent-replied / resolved / reopened / closed all fan out via `notification/dispatch` for authenticated customers (email + SMS + bell honoring per-event prefs). Guest tickets keep the direct-email fallback at every site. Customer notification-prefs UI now lists all 5 events; `ticket.customer_replied` removed from the customer view (it was always an agent-facing event).
- **2026-05-21 — Ticket-resolved notification + in-portal CSAT:** `resolveTicket` now dispatches `ticket.resolved` through Inngest (email + SMS + bell) honoring per-event customer preferences; guest tickets still fall back to direct email. New `submitCsatFromPortal` server action + `<CustomerCsatPrompt>` UI on the customer ticket-detail page lets the customer give "Yes, fixed" / "No, still broken" feedback from inside the portal — Yes closes the ticket, No reopens it.
- **2026-05-21 — Customers don't pick ticket priority:** priority dropdown removed from `/portal/submit` and `/portal/tickets/new`. Server schemas default to `medium`. Coordinator triages priority on review; `recomputeSlaForTicket` re-stamps SLA columns when priority changes. Staff-side `createTicketOnBehalf` keeps the field.
- **2026-05-21 — Phone field uses `react-phone-number-input` (country picker):** plain `<input type="tel">` swapped for the library's flag-dropdown + auto-formatting + per-country validation. Default country `PK`. Tailwind-friendly theme overrides in `src/app/globals.css`. Server zod check stays as defense-in-depth.
- **2026-05-21 — Phone everywhere + customer portal shell upgrade:** Phone collection wired into customer sign-up, customer profile, admin user-create, admin profile (E.164 optional, empty → null, magic-link sign-up persists via Better Auth `additionalFields`). Customer portal gets a real shell: `<CustomerSidebar>` on `lg+` mirroring the admin layout, a `/portal` dashboard with status stat cards and recent tickets, notifications bell in the topbar, and ticket-list filters (status chips + search, URL-driven).
- **2026-05-21 — Sanitizer swap + sign-in production fixes:** `isomorphic-dompurify` replaced with `sanitize-html` (a transitive ESM dep crashed every server action that imported the sanitizer on Vercel's Node 24 / Next 16 runtime); proxy now checks both `better-auth.session_token` AND `__Secure-better-auth.session_token` so magic-link-verified users don't bounce back to sign-in; sign-in is existing-accounts-only — unknown emails get a friendly `account_not_found` error pointing at `/portal/sign-up` where the name field is captured.
- **2026-05-22 — Production-pass corrections:** `createUser` now inserts `users` + `accounts` rows directly via Drizzle (with `accounts.password = null`), bypassing `auth.api.signUpEmail` entirely so no session is ever issued for the new user — supersedes the cookie-restore approach which failed under HTTPS due to Better Auth's `__Secure-` prefix. Setup-invite URL carries `&email=…`, allowing the setup form to auto-sign-in after reset → user lands on `/admin` on first click. Sidebar links filter by per-item `requires: Permission`. Hierarchy filters to users with at least one non-Customer role. Permissions matrix uses native `<details>`/`<summary>`. Role View modal renders human-friendly labels via the existing matrix i18n namespace.
- **2026-05-21 — Stream / session / setup fixes:** `classifyStream` makes "internal vs external" role-driven (staff role wins over email domain); first attempt at admin user-create session safety (superseded — see 2026-05-22); `/admin/setup` exempted from the edge proxy's auth gate so the setup-invite link doesn't redirect into a circular dead end.
- **2026-05-10 — Customer portal:** magic-link primary + password fallback; identity reconciliation inside `databaseHooks.user.create.after`; single route group; server-side role gate in the portal layout; customer-channel writes never email the customer back; internal-note attachments doubly guarded against strict customers; stricter rate limits for portal auth than admin; customer notification preferences ship with `ticket.assigned` and `ticket.customer_replied` only (resolved is held back).
- **2026-05-08 — Accessibility (M14.5):** WCAG 2.1 AA enforced in three layers; `color-contrast` temporarily off in CI; skip-link in both gated and public layouts; matrix + tree use native form/list markup.

When you make a decision that won't be obvious from the diff alone, add a new dated section at the top of `DECISIONS.md` AND reference it from the relevant section of this README so the canonical doc stays current.