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
| `tickets.ts` | `tickets` | UUID PK + human-readable `ticket_number` generated by Postgres function `generate_ticket_number()`; CHECK constraints for category/priority/status/stream/origin/csat/escalation_reason; indexes for status+priority, assignment, customer, escalation, due-date scans, anonymization cleanup |
| `messages.ts` | `messages` | `author_type` ∈ {agent, customer, system}, `channel` ∈ {email, portal, dashboard, system}, `body_format` ∈ {text, html}, `is_internal_note`, `is_resolution_note`, `is_anonymized` |
| `attachments.ts` | `attachments` | Bounded size (≤10 MiB), `scan_status` ∈ {pending, clean, quarantined}, partial indexes for the pending-scan queue and orphan-cleanup window |
| `procurement.ts` | `procurement_requests` | Multi-step status enum, coordinator/admin decision metadata, rejection step capture, type/urgency CHECKs |
| `audit.ts` | `audit_log` | Append-only; UPDATE/DELETE are revoked at the database role level in the initial migration; indexes for timestamp, actor, action, target, request_id |
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
  - `tickets/`, `tickets/new`, `tickets/[id]`
  - `procurement/`, `procurement/[id]`
  - `users/`, `users/new`, `users/[id]`
  - `roles/`, `roles/new`, `roles/[id]`
  - `hierarchy/` — visual creator-tree (includes any user with at least one non-Customer role via a correlated `EXISTS` subquery on `user_roles`; pure-Customer accounts are filtered out, but all staff roles — including Technicians who can't themselves create users — remain so Super Admin's descendants are visible)
  - `reports/`
  - `settings/`
  - `audit/`
  - `profile/`

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
- `audit/export/route.ts` — streamed CSV of audit entries (gated by `audit.export`); filters mirror the dashboard UI
- `reports/export/route.ts` — synthesized CSV summary of ticket health + procurement spend (gated by `reports.export`)

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
| `audit.ts` | `audit({...})` — single insert into `audit_log`; auto-detects active impersonation cookie and stamps `impersonatorId` when present |
| `auth/` | Better Auth setup + `getSessionUser` / `requireSessionUser` (returns the impersonated identity when an `axiom_imp` cookie is valid), `can()` permission gate, `productionContext` (DB-backed `isDescendantOf` / `userHasRole` / `isLastActiveSuperAdmin`), `ticketsVisibilityCondition`, `permissions.ts` (closed set + per-role defaults), `lockout.ts` (Redis-backed 5-failure / 15-minute window), `reauth.ts` (5-minute freshness for sensitive actions), `impersonation.ts` (HMAC-signed cookie), `client.ts` (Better Auth React client) |
| `branding/` | `loadBranding()` reads the `branding` setting, normalizes against known presets, falls back to `DEFAULT_BRANDING`; `presets.ts` enumerates accent + gradient classes (all class names appear as literals so Tailwind JIT keeps them) |
| `crypto.ts` | AES-256-GCM envelope encrypt/decrypt for sensitive fields. No callers yet — reserved for future encrypted-at-rest columns |
| `customer/` | `reconcile.ts` (Better Auth hook helpers), `queries.ts` (customer-scoped `listMyTickets`, `getMyTicketByNumber`, `getGuestTicket`, `getMyMessageThread` — internal notes filtered at the SQL layer via `customerVisibleMessages()`) |
| `db/` | Drizzle client (HTTP + WS Pool), schema, migrations, seed scripts |
| `email/` | Resend client, `sendEmail` wrapper (renders React Email templates → resolves locale → adds optional `Reply-To: ticket+AX-XXXX@<domain>` and `From: "Name — Brand"` display), Svix signature verifier, inbound payload normalizer + ticket-number extractor, inbound filter (auto-reply / bounce / list-mail / empty-after-strip), quote/signature stripper |
| `email/templates/` | 19 React Email templates (`account-lockout`, `attachment-quarantined`, `customer-magic-link`, `customer-welcome`, `escalation-alert`, `inbound-bounce`, `inbound-closed-ticket`, `new-assignment`, `procurement-*` × 4, `staff-setup-invite`, `ticket-*` × 6) + `_layout.tsx` |
| `errors.ts` | `ForbiddenError`, `NotFoundError` — only two error subclasses used by Server Actions |
| `format.ts` | `formatBytes`, `initials` |
| `i18n.ts` | next-intl request resolver + `pickLocale` helper |
| `messages/` | `sanitize.ts` — `sanitize-html` allowlist matching what TipTap can produce, with `transformTags` rewriting every `<a>` to carry `target="_blank" rel="noopener noreferrer"` and `allowedSchemes` restricted to `http/https/mailto` (blocks `javascript:` / `data:` URLs). Pure-CommonJS package by design — does NOT use jsdom, so we don't take on the ESM-interop landmines that come with isomorphic-dompurify. Plus `visibility.ts` (SQL predicate hiding internal notes from customer queries). |
| `notifications/` | `registry.ts` maps every `NotificationEventType` to its in-app `titleKey`/`bodyKey`; `sms-types.ts` defines the SMS template union without importing Twilio |
| `ratelimit.ts` | 19 named Upstash sliding-window limiters covering public submit, login, password reset, inbound email flood, every authenticated per-user-per-action, and customer-portal flows |
| `reports/queries.ts` | Ticket health + procurement spend aggregates backing the reports dashboard and CSV export |
| `request.ts` | `getAppUrl` + `clientIp` (X-Forwarded-For-aware) |
| `settings.ts` + `settings-registry.ts` | `getSetting(k)` / `getSettings([…])` readers + a zod schema map describing every writeable settings key. `READ_ONLY_AFTER_FIRST_SET` includes `inbound_email_domain` |
| `sla.ts` + `sla-compute.ts` | DB-backed SLA settings loader + pure DST-aware business-hours math (`computeDueAt`). The pure module is testable without `DATABASE_URL` |
| `sms/` | Twilio lazy client + `sendSms` wrapper that renders SMS bodies via next-intl namespaces, points status callbacks at `/api/twilio/status`, never throws on missing app URL |
| `storage/` | R2 client (`client.ts`), `presignUploadUrl` (5-minute PUT), `getSignedDownloadUrl` (5-minute GET, 1-hour for avatars), `fetchObject` / `fetchObjectPrefix`, `deleteObject`, MIME allowlist + filename sanitizer (`mime.ts`), magic-byte verification (`magic-bytes.ts`), virus-scan abstraction (`virus-scan.ts` selects `disabled` | `eicar` | `clamav-rest`) |
| `tickets/load.ts` | `loadTicketScope` (superset projection used by every action), `listAssignableTechnicians` (anyone whose role grants `tickets.update`) |
| `tickets/stream.ts` | `classifyStream(email)` — single source of truth for "internal vs external" on every ticket-creation path. **Role beats domain**: if the email maps to an active user holding any staff role (Super Admin / IT Director / Coordinator / Technician), the ticket is internal regardless of email domain; otherwise the `internal_email_domains` allowlist applies. Used by `createTicket`, `createTicketOnBehalf`, `customerCreateTicket`, and the inbound-email processor. See `DECISIONS.md` 2026-05-21. |
| `ticket-number.ts` | Calls the Postgres `generate_ticket_number()` function |
| `tokens.ts` | HMAC guest tokens (`signGuestToken` / `verifyGuestToken` / `guestTicketUrl`) and CSAT tokens (`signCsatToken` / `verifyCsatToken`) — payloads are `<field>|<field>:<sig>` base64url-encoded |
| `turnstile.ts` | Server-side Cloudflare Turnstile verification; skips in dev when `TURNSTILE_SECRET` is unset, hard-fails in production |
| `utils.ts` | `cn(...)` (clsx + tailwind-merge) |

### 7.1 Tests under `lib/`

Pure-logic modules ship with co-located vitest files: `crypto.test.ts`, `sla-compute.test.ts`, `tokens.test.ts`, `messages/sanitize` (covered indirectly), `storage/magic-bytes.test.ts`, `storage/mime.test.ts`, `storage/virus-scan.test.ts`, `email/inbound-filter.test.ts`, `email/inbound-payload.test.ts`, `email/webhook-signature.test.ts`, `auth/can.test.ts`. Coverage thresholds (vitest) are 50% lines/functions/statements, 40% branches.

---

## 8. Inngest functions (`src/inngest/`)

`client.ts` defines the typed event union (`Events`) and the dispatch payload (`NotificationDispatchPayload`). `functions/index.ts` re-exports every function; `/api/inngest/route.ts` serves them.

| Function | Trigger | What it does |
|---|---|---|
| `auto-close-resolved-tickets` | cron `0 * * * *` | Closes resolved tickets older than 24h that the customer never CSAT-confirmed; sends `ticket_closed`; audits `ticket.auto_close` with `actorId: null` |
| `process-inbound-email` | event `email/inbound.received` | Filter → extract ticket number → either reply to the customer (bounce / closed-ticket) or insert message + ingest attachments + dispatch `ticket.customer_replied`. When no ticket number is found, opens a fresh ticket from the email (honoring `inbound_sender_allowlist_only`) |
| `scan-attachment` | event `attachment/uploaded`, 2 retries | Loads row → fetches bytes from R2 → routes through `scanBytes` → on `infected` flips to `quarantined`, deletes the R2 object, audit-logs, dispatches `attachment.quarantined`. Falls open to `clean` after scanner errors (still audited) |
| `sla-monitor` | cron `*/5 * * * *` | Scans in-flight tickets, marks 50% / 80% / 100% transitions exactly once via the dedicated stamp columns. 50% is in-app only; 80%+ adds SMS via the dispatcher; breaches audit `ticket.sla_breach` |
| `dispatch-notification` | event `notification/dispatch` | Resolves recipients from `recipientUserIds` ∪ `recipientRoles`, loads `notification_preferences`, fans out into per-recipient `notification/email` / `notification/sms` / `notification/in-app` events |
| `send-email-notification` | event `notification/email`, 3 retries | Calls `sendEmail` |
| `send-sms-notification` | event `notification/sms`, 3 retries | Calls `sendSms` |
| `send-in-app-notification` | event `notification/in-app`, 3 retries | Inserts into `notifications` with i18n keys + arg JSON |
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
| `tickets.ts` | `createTicket` (public, Turnstile + IP + email rate-limit + honeypot), `createTicketOnBehalf`, `assignTicket`, `replyToTicket`, `addInternalNote`, `resolveTicket` (note / skip discriminated union), `reopenTicket`, `escalateTicket` (categorical reason + optional note), `deescalateTicket`, `deleteTicket` (soft delete), `mergeTickets` (moves messages + attachments, closes source with `duplicate_of_id`) |
| `customer-portal.ts` | `requestMagicLink`, `requestSignUpMagicLink`, `customerReply` (always `authorType: 'customer'` + `channel: 'portal'`; never emails the customer back), `guestReply` (token-authenticated, no session, per-ticket + per-IP rate limits), `customerCreateTicket` (5/user/day) |
| `users.ts` | `createUser` — bypasses `auth.api.signUpEmail` and **inserts the `users` + `accounts` rows directly via Drizzle in a single `transactional`** (`accounts.password = null` until the user completes the setup-invite email). This avoids the session-issuing side effect of `signUpEmail` entirely, so the calling admin keeps their session no matter the cookie name Better Auth chooses across environments. Plus the standard checks (cannot-grant-what-you-don't-have on role assignment; Super Admin grants require re-auth freshness; duplicate-email pre-check). Also: `updateUser`, `deactivateUser` / `reactivateUser`, `resetPassword` (kicks Better Auth `requestPasswordReset`), `unlockUser` (clears Redis + DB lockout), `getDescendants` (BFS over `createdById`, depth-capped at 50). |
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

- `ui/` — `button`, `input`, `card`, `dropdown-menu`, `badge`, `skeleton`, `avatar`, `separator`, `label`, `tooltip`, `textarea`, `dialog`, `table`, `row-actions`, `rich-text-editor` (TipTap), `pagination`, `page-size-select`, `select`, `spinner`, `url-filter-select`, `url-search-input`
- `shared/` — `topbar`, `sidebar` (each `NAV_ITEM` declares the `Permission` it requires; the gated layout passes the caller's permission array and the sidebar filters before rendering so a user never sees a link they can't reach), `profile-menu`, `notification-bell`, `global-search` (⌘K palette), `skip-link`, `impersonation-banner`, `reauth-modal` + `use-reauth-gate`
- `tickets/` — `badges` (priority + status pills using the §13 token map), `assign-control`, `reopen-button`, `create-on-behalf-form`, `escalate-modal`, `resolve-modal` (note + skip), `reply-composer`, `message-thread`, `message-body`, `ticket-filters`, `ticket-row-actions`, `merge-modal`
- `users/` — `create-user-form`, `edit-user-form`, `account-actions`, `deactivate-modal`, `impersonate-button`, `role-multi-select`, `user-row-actions`
- `roles/` — `create-role-form`, `edit-role-form`, `permissions-matrix`, `role-row-actions`
- `procurement/` — `status-badge`, `request-form`, `ticket-section`, `decision-buttons`, `procurement-row-actions`
- `settings/` — `branding-form`, `business-hours-form`, `sla-form`, `holidays-list`, `string-list-form`, `scalar-form`, `rate-limit-form`, `save-button`
- `audit/` — `details-modal`, `load-more`
- `reports/charts.tsx`
- `profile/` — `account-form`, `password-form`, `preferences-grid`, `sessions-list`
- `customer/` — `customer-topbar`, `customer-ticket-list`, `customer-ticket-header`, `customer-message-thread`, `customer-reply-composer`, `guest-reply-composer`, `customer-new-ticket-form`, `customer-profile-form`, `customer-notification-prefs`, `avatar-upload`
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
| Tickets | `view`, `create`, `update`, `assign`, `reply`, `internal_note`, `resolve`, `resolve_skip_note`, `reopen`, `escalate`, `deescalate`, `delete`, `export` |
| Procurement | `view`, `create`, `update`, `approve`, `reject`, `mark_purchased`, `mark_delivered`, `export` |
| Reports | `view`, `export` |
| Users | `view`, `create`, `update`, `deactivate`, `reactivate`, `reset_password`, `impersonate`, `unlock` |
| Roles | `view`, `create`, `update`, `delete` |
| Settings | `view`, `update` |
| Audit | `view`, `export` |

Seeded role defaults (per `permissions.ts`):

- **Super Admin** — every permission
- **IT Director** — read-mostly: ticket view/update/assign/reply/internal_note/deescalate + reports.view + audit.view
- **Coordinator** — operational: ticket triage incl. resolve_skip_note; procurement approve/reject/mark_*; users.view; reports.view
- **Technician** — owns their assigned tickets: ticket view/update/reply/internal_note/resolve/escalate; procurement view/create/update
- **Customer** — self-service: ticket view/create/reply (own tickets only via scope checks); procurement view/create

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

Some actions require re-typing the password within the last 5 minutes even when the session is otherwise valid: granting Super Admin role, app-wide setting changes, account deactivation, password resets. `verifyReauth` writes a Redis key with TTL; `isReauthFresh(userId)` is the gate. Server Actions return `reauthRequiredResult()` when the gate fails; clients pop the `<ReauthModal>` and retry.

### 12.4 Impersonation (`lib/auth/impersonation.ts`)

An admin with `users.impersonate` can act-as another user. The active context lives in an HTTP-only, signed `axiom_imp` cookie carrying `<impersonatorId>|<targetId>` HMAC-SHA256. `getSessionUser` returns the impersonated identity (with `isImpersonating: true`) only when the actual signed-in user matches the impersonator id baked into the cookie. Both start + end are audited; stacking is refused; cookie max-age is 1 hour.

---

## 13. SLA model

- **Pure math** (`lib/sla-compute.ts`): `computeDueAt(createdAt, slaMinutes, respectBusinessHours, config)` walks UTC instants in IANA-tz wall-clock, skipping non-working days and holidays. Two-pass DST correction handles the spring-forward / fall-back hour. The pure module has no DB dependency, so vitest can exercise it without `DATABASE_URL`.
- **DB-backed wrapper** (`lib/sla.ts`): `loadSlaSettings(from, to)` reads settings + the holiday table in one query, `computeDueTimesForNewTicket({ createdAt, priority })` is what every ticket-creation path uses, `recomputeSlaForTicket(id)` re-stamps `responseDueAt` / `resolutionDueAt` and clears the warning columns when priority changes mid-flight (no-op for resolved/closed tickets).
- **Monitor** (`inngest/functions/sla-monitor.ts`): every 5 minutes, scans in-flight tickets, marks 50% / 80% / 100% transitions exactly once via `sla_warning_50_at`, `sla_warning_80_at`, `sla_breached_at`. The DB column NULL-check is what makes it idempotent.
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

## 15. Inbound email pipeline

1. Resend POSTs to `/api/email/inbound`.
2. Route verifies Svix signature against `RESEND_WEBHOOK_SECRET`.
3. Route rate-limits 1000/min by IP (after signature check so attackers can't drain the budget with junk).
4. Route deduplicates via `processed_webhook_events(provider='resend', event_id=<svix-id>)`.
5. Route normalizes via `normalizeResendInbound`, emits `email/inbound.received`.
6. `process-inbound-email` runs the decision tree:
   - `shouldAcceptInbound` drops auto-submitted / vacation-responders / bounces / list-mail / precedence-bulk / empty-after-strip.
   - `extractTicketNumber` looks at the `ticket+AX-XXXX@<domain>` sub-address, then `[AX-XXXX]` in subject, then `In-Reply-To`/`References` headers.
   - Missing ticket number → call `createTicketFromInbound` (honors `inbound_sender_allowlist_only`, strips `Re:`/`Fwd:`, defaults category/priority).
   - Ticket not found → send `inbound_bounce` reply.
   - Ticket closed → send `inbound_closed_ticket` reply.
   - Loop detection: >5 messages from the same sender on the same ticket in 5 minutes → drop with a `loop-detected` log line.
   - Otherwise: insert the customer message (after quote/signature strip), ingest attachments (mailparser → MIME + size + magic-byte filter → R2 upload → `attachment/uploaded` event), touch `tickets.updated_at`, dispatch `ticket.customer_replied` to the assigned tech.

Reply-To routing: outbound emails with `replyToTicket: true` set `Reply-To: ticket+AX-XXXX@<inbound_email_domain>` so the customer's reply lands back on the same ticket.

---

## 16. Attachment pipeline

1. Client requests `generateUploadUrl({ ticketId, fileName, mimeType, sizeBytes })`. The action validates MIME (against `lib/storage/mime.ts` allowlist) + size, calls `can('tickets.reply', ticket)`, inserts a pending `attachments` row, mints a presigned PUT URL (`storage/upload.ts`), returns it.
2. Client `PUT`s the bytes directly to R2.
3. Client calls `confirmUpload({ attachmentId })`. The action HEADs R2 to verify the object exists, range-reads the first 16 bytes, verifies the magic bytes match the declared MIME (`storage/magic-bytes.ts`). If they don't, the row flips to `quarantined` and the object is deleted; if they do, the row flips to `pending` with `uploadConfirmedAt` set, and the action emits `attachment/uploaded`.
4. `scan-attachment` Inngest function fetches the bytes from R2, runs them through the configured provider (`disabled` / `eicar` / `clamav-rest`), and either marks `clean` or flips to `quarantined` + deletes the R2 object + dispatches `attachment.quarantined` to the uploader and the assigned tech.
5. `getDownloadUrl` mints a 5-minute signed GET URL with `Content-Disposition: attachment` for risky types (PDF/zip), inline for others. It blocks strict customers from downloading attachments whose parent message has `is_internal_note = true` — even when they own the ticket (see DECISIONS.md 2026-05-10).

Storage keys: `<env>/<ticketId>/<attachmentId>/<sanitizedFilename>` for attachments, `<env>/avatars/<userId>/<timestamp>.<ext>` for profile pictures. Avatar signed URLs have a 1-hour TTL (vs. 5 minutes elsewhere) so the browser can cache them across pages; the timestamp suffix guarantees a fresh avatar produces a new key.

---

## 17. CSAT flow

1. Agent resolves a ticket → `resolveTicket` inserts a customer-visible resolution note (or, on the skip-note coordinator path, an internal note explaining why), then **dispatches `ticket.resolved` through Inngest** (email + SMS + in-app, gated per the customer's per-event preferences). The email carries two HMAC-signed CSAT buttons; the in-app row deep-links to the ticket detail page.
2. The customer has two paths to give feedback — same outcome either way:
   - **From email:** click "Satisfied" / "Not satisfied" → `GET /csat/confirm?t=…&tk=…` → `verifyCsatToken` checks the HMAC.
   - **From the portal:** open the ticket detail page while it's `resolved` → `<CustomerCsatPrompt>` shows two buttons → `submitCsatFromPortal(ticketId, response)` server action verifies ownership (`customer_id === user.id`) without a token.
3. Either path branches the same way:
   - Already responded → recap banner (portal) / redirect to `/csat/result?status=already` (email).
   - Already moved past resolved (e.g. a new agent reply reopened the ticket) → record the response on the row but don't roll status back.
   - Satisfied + still resolved → close the ticket, send `ticket_closed`.
   - Unsatisfied + still resolved → reopen (back to `in_progress` if still assigned, else `open`), bump `reopened_count`, send `ticket_reopened` to the customer and notify the assigned tech.
4. After 24h with no response on either path, `auto-close-resolved-tickets` closes the ticket with `reason: csat_no_response_24h` and sends `ticket_closed`.

**Guest tickets** (no `customer_id`) take a slightly different path: no in-portal prompt (they don't have a portal account), `resolveTicket` falls back to a direct `sendEmail` for the resolution email (no preferences row to consult, no SMS phone, no bell inbox). The email-link CSAT path still works exactly the same for them.

---

## 18. Public ticket submission

`/portal/submit` → `submission-form.tsx` → `createTicket` Server Action. Layered defenses:

1. zod validation (name 1–120, email, subject 3–150, description 20–5000, category in 5 enum values). **Priority is not asked of the customer** — schema defaults to `medium`, Coordinator triages on review.
2. Honeypot field — if a bot fills it, the action returns a success-shaped result with `ticketNumber: "AX-XXXX"` to discourage retries.
3. IP rate limit (`publicSubmitByIp`, 5/hour) and email rate limit (`publicSubmitByEmail`, 20/day) — both checked before Turnstile to avoid burning the captcha budget.
4. Cloudflare Turnstile (`verifyTurnstile`) — required in production, skipped in dev with a warning when no secret is set.
5. Stream classification via `classifyStream(email)` — staff role membership wins, otherwise the `internal_email_domains` allowlist decides.
6. SLA deadlines computed at insert time from the ticket's priority.
7. Insert ticket + initial `messages` row inside a single `transactional`.
8. Audit (`actorId: null` so the row is attributed to a public submission).
9. Best-effort confirmation email with a guest tracking URL (`guestTicketUrl`) — failures don't roll the ticket back.

---

## 19. Auth flows

### 19.1 Admin / staff sign-in

- **Form path:** `signInWithLockout(email, password)` Server Action wraps `auth.api.signInEmail` with the per-account lockout described in §12.2. On success Better Auth's `nextCookies()` plugin (registered in `lib/auth/index.ts`) sets the session cookie via Next.js `cookies()`.
- **Session lifetime:** absolute 7 days (`session.expiresIn`), `updateAge` 5 minutes (cookie is refreshed on each window of activity). The admin gated layout independently enforces a 12-hour idle timeout by reading `session.session.updatedAt`.
- **First-time staff setup:** when an admin creates a user, the system fires Better Auth's `requestPasswordReset` flow, which sends `staff_setup_invite` (copy varies based on whether `users.lastLoginAt` is null) pointing at `/admin/setup?token=…&email=…`. The setup form sets the password via `auth.api.resetPassword` and then immediately signs the user in via `auth.api.signInEmail` with that same email + password — so the user lands on `/admin` on the first submit click. If the auto-sign-in fails (e.g. account locked), the form falls back to `/admin/login?reset=ok` and the user signs in manually.

### 19.2 Customer auth

- **Primary:** magic-link via Better Auth's `magicLink` plugin (`expiresIn: 600s`, `rateLimit: 3/email/hour`). On verification, `databaseHooks.user.create.after` runs `assignCustomerRole` + `claimTicketsForCustomer`.
- **Fallback:** password (Better Auth `emailAndPassword`, min 12 chars).
- **Guest:** signed-URL ticket view + reply with no account, gated by `verifyGuestToken` + per-ticket and per-IP rate limits.

### 19.3 Passkeys

The `passkeys` table is migrated and Better Auth's passkey plugin is wired through Drizzle, but no UI surface exposes them yet — they're a forward placeholder.

---

## 20. Audit log

Every privileged Server Action calls `audit({...})` after a successful state change. Conventions:

- `action` follows `domain.verb` (`ticket.assign`, `user.deactivate`, `procurement.approve`, …).
- `targetType` + `targetId` identify the row (use the human-readable `ticketNumber` for tickets, UUIDs elsewhere).
- `before` / `after` are JSON snapshots of only the fields that changed.
- Failures (auth / validation) are NOT audited — they're logged with `console.warn` / `console.error`.
- Impersonation: callers don't plumb `impersonatorId` through. `audit()` auto-detects an active impersonation cookie and stamps the real admin's id; explicit overrides win.
- Database role grants restrict UPDATE/DELETE on `audit_log` (applied as a custom step in migration `0000`). Anyone with write access to Postgres can still alter the grants, so the table is hardened against the application, not against an admin with a psql shell.
- `/api/audit/export` streams CSV chunks via `iterAuditEntries` (no full materialization).

---

## 21. Settings

| Source | Purpose |
|---|---|
| `lib/settings-registry.ts` | Zod schema map for every writeable key + `READ_ONLY_AFTER_FIRST_SET` (currently just `inbound_email_domain`) |
| `lib/settings.ts` | `getSetting<T>(key)`, `getSettings<T>([k1, k2, ...])` readers |
| `lib/db/seed.ts` (DEFAULT_SETTINGS) | The full seeded list — about 30 keys |
| `app/(admin)/admin/(gated)/settings/page.tsx` + `components/settings/*-form.tsx` | UI |

Categories:
- **Business hours:** timezone, start/end hour, working days, holidays (separate table)
- **SLA:** `sla.<priority>.{response_minutes, resolve_minutes, respect_business_hours}` for each of critical / high / medium / low (time minutes seeded as null — admin sets them via Settings before the monitor is meaningful)
- **Email + stream:** `internal_email_domains`, `support_email`, `inbound_email_domain`, `inbound_sender_allowlist_only`, `default_sender_name`, `default_sender_email`, `customer_response_window_hours`
- **Procurement:** `procurement_approval_threshold` (0 = single-step coordinator only; positive = two-step Coordinator + Super Admin above the threshold)
- **Rate limits:** `rate_limits.{public_submit, login, password_reset, guest_portal, authenticated.*}` — separate keys for each authenticated bucket
- **File uploads:** `file_upload.max_size_bytes`, `file_upload.allowed_mime_types`
- **Virus scanning:** `virus_scan.{enabled, provider, endpoint}` — provider is `disabled` | `eicar` | `clamav-rest`
- **Branding:** atomic `branding` object (`brandName`, `brandAccent`, `accentColor`, `gradientPreset`) — must move together

`updateSetting` requires re-auth freshness, audits before/after, and `revalidatePath`s any pages that read the changed key.

---

## 22. i18n

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

## 23. Accessibility

Per `DECISIONS.md` 2026-05-08, target is **WCAG 2.1 AA**, enforced in three layers:

1. **Lint:** `eslint-plugin-jsx-a11y` strict rules (alt-text, label-has-associated-control, role-has-required-aria-props, etc.). Exceptions: `components/ui/` (shadcn primitives) has `label-has-associated-control` off; consumers wire labels at call sites.
2. **E2E:** `@axe-core/playwright` runs against key routes in `e2e/a11y.spec.ts`. `color-contrast` is temporarily disabled in CI (flickers under dark-mode media-query handling); manual audit is on the carryover list.
3. **Markup:** the gated admin layout AND the public layout both render a `<SkipLink>` targeting `<main id="main-content">`. The shared `Table` primitive defaults to `<th scope="col">`. The permissions matrix uses native `<details>`/`<summary>` for module accordions (browser owns the open/closed state — no React state to go stale) and native `<input type="checkbox">` + `<label>` for grants; the hierarchy tree is recursive `<ul><li>` so screen readers announce them as standard controls.
4. **Body classes:** `accessibility-high-contrast` (`filter: contrast(1.4)`), `accessibility-large-text` (`zoom: 1.15`), `accessibility-reduce-motion` (kills animations/transitions/smooth-scroll).

---

## 24. Security headers + posture

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
- **HMAC tokens:** all guest URLs (`guestTicketUrl`), CSAT confirmations, and impersonation cookies are HMAC-SHA256 signed with `crypto.timingSafeEqual` verification.
- **Sanitization:** every message HTML body goes through `sanitizeMessageHtml` before storage; `<a>` is force-rewritten to `target="_blank" rel="noopener noreferrer"` and `javascript:`/`data:` URIs are blocked.
- **File uploads:** MIME allowlist + magic-byte verification + per-file size cap + filename sanitizer + optional virus scan + force `Content-Disposition: attachment` for browser-renderable risky types (PDF, zip).
- **No 2FA at present** — password + lockout + per-action re-auth covers the threat model. The Better Auth twoFactor plugin can be re-added later.

---

## 25. Scripts

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

---

## 26. Conventions

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

## 27. Decision log

Architectural decisions that aren't obvious from reading the code live in [`DECISIONS.md`](./DECISIONS.md), newest first. Examples currently captured:

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