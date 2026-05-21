# Architecture & policy decisions

A running log of decisions that aren't obvious from reading the code. New
entries go at the top; date them.

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
