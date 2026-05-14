# Architecture & policy decisions

A running log of decisions that aren't obvious from reading the code. New
entries go at the top; date them.

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
