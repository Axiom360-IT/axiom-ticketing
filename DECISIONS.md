# Architecture & policy decisions

A running log of decisions that aren't obvious from reading the code. New
entries go at the top; date them.

---

## 2026-05-22 · Admin user-create direct insert; setup-invite auto-sign-in; sidebar permission gating; hierarchy filter; matrix native `<details>`

A bundle of corrections after the system was used end-to-end in production. Common thread: every fix here closes a gap that wasn't obvious from reading the code alone — only from operating it.

- **`createUser` bypasses `auth.api.signUpEmail` entirely.** The previous fix (capture the admin's `better-auth.session_token` cookie and restore it after signUpEmail) failed in production. The reason is environment-dependent cookie naming: Better Auth promotes the cookie to the `__Secure-` prefix over HTTPS, so a hardcoded `"better-auth.session_token"` lookup misses the actual cookie value and the admin still ends up signed in as the new user. New approach: don't fight Better Auth's session-issuing behavior — sidestep it. Insert the `users` + `accounts` rows directly via Drizzle inside a single `transactional`, with `accounts.providerId = "credential"`, `accounts.accountId = <newUserId>`, `accounts.password = null`. The user has no way to authenticate via credential until they click the setup-invite link, which routes through `auth.api.resetPassword` and stamps a real hash on the `accounts.password` column. Better Auth never issues a session for the new user because no Better Auth sign-up endpoint is called. The admin's session cookie is never touched. The whole class of "what does the cookie name happen to be today" bugs is gone.

- **Setup form auto-signs-in on success.** Previously, clicking "Set my password" called `auth.api.resetPassword` and redirected to `/admin/login?reset=ok` — the user then had to type their brand-new password a second time to reach `/admin`. To users this looked like a broken first-click; they assumed the first submit didn't take. Fix: the setup-invite URL now carries `&email=<email>` alongside the token (see `lib/auth/index.ts:sendResetPassword`). The `setupPassword` server action signs the user in via `auth.api.signInEmail` immediately after the reset succeeds, returning `{ ok: true, signedIn: true }` on success. The client redirects to `/admin` on `signedIn: true` and to `/admin/login?reset=ok` only when the auto-sign-in fails (rare — e.g., account already locked). The setup form ALSO keeps `submitting=true` past navigation so a fast double-clicker can't fire a second submit against a now-consumed token.

- **Sidebar links gated per-permission.** Each `NavItem` in `components/shared/sidebar.tsx` declares its `requires: Permission`. The gated layout passes the caller's permission array; the sidebar filters before rendering. A Coordinator who lacks `roles.view`, `settings.view`, `audit.view` no longer sees those nav entries. Keeps the sidebar honest with the page-level redirects that gate the destinations themselves — if you can see the link, you can reach the page.

- **Hierarchy excludes non-creator users.** `/admin/hierarchy` previously showed every user, including Customers and Technicians who can't themselves create children. The hierarchy is meant to visualize the creator chain, so its contents should match its purpose. New query adds a correlated `EXISTS` subquery on `user_roles` → `role_permissions` requiring at least one of (`users.create`, `roles.create`). Filtered users are dropped from the tree entirely; if a filtered user had a creator-eligible parent, the surviving subtree just doesn't include them.

- **Permissions matrix uses native `<details>`/`<summary>`.** The previous `useState<Record<string, boolean>>` accordion was reported as not expanding for some users — likely a React Compiler memoization or stale closure issue, though we never pinned the exact cause. Native `<details>` lets the browser own the open/closed bit; chevron rotation is driven by `group-open/details:rotate-90` on the icon. The "Select all" toggle moved OUT of `<summary>` into the body so clicks on it don't route through the browser's open/close handling. Whole class of state-stuck bugs gone.

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
