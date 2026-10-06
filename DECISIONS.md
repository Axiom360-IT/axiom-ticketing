# Architecture & policy decisions

A running log of decisions that aren't obvious from reading the code. New
entries go at the top; date them.

---

## 2026-10-06 · Automations panel, and scheduled reports

Seventeen background jobs were already running. Their only trace was the
Inngest dashboard, so "did the follow-up monitor fire last night?" could not be
answered from inside the app, and the answer to "what does this system do on
its own?" lived only in `src/inngest/functions/`.

**What was actually wrong, after looking rather than assuming.** The settings
registry is comprehensive — 61 keys, including every automation knob
(`customer_followup.*`, `unassigned_alert.*`, `sla.*`), with the constants in
each job file being *fallbacks*, not the source of truth. Two real gaps:

  1. No run history and no inventory. Nothing recorded that a job ran.
  2. `src/components/settings/sla-form.tsx` existed, was complete, and was
     rendered **nowhere**. The twelve SLA target keys drive every due date in
     the product and had no reachable UI. It is now mounted on this page,
     beside the monitor that measures against it.

**Scheduled reports are NOT one Inngest cron each.** A cron expression lives in
code and ships in a deploy; a report someone creates at 16:05 for 19:00 the
same day cannot wait for a release. One dispatcher runs every five minutes and
asks a pure function what is due. Five minutes is therefore the resolution of
the feature, and the UI says so rather than implying to-the-minute delivery.

**All eight pre-existing crons run in UTC** — not one carries a `TZ=` prefix,
so `monthly-plan-reset` at "0 6 * * *" is mid-morning in Dubai, not 06:00.
Rather than rewrite them, the panel renders each schedule's local equivalent
beside the raw expression, and the dispatcher interprets a report's "19:00"
against `business_hours.timezone` in `isReportDue` rather than delegating it to
the scheduler. `Intl.DateTimeFormat` does that conversion because it carries
the IANA database, including the DST transitions a fixed UTC offset gets wrong
twice a year.

**The double-send guard is a stored local date**, `last_run_on`. The due check
is deliberately "at or after the scheduled minute", not "equals" — a
five-minute dispatcher would otherwise miss a report set for 19:02 forever —
and without the date it would then send twelve times an hour until midnight.
The slot is claimed BEFORE sending, so a crash half way through a twelve-person
list loses the remainder rather than re-sending to the people already served.

**A toggle is a settings write.** The switches go through the existing
`updateSetting`, inheriting its zod validation, rate limit, audit entry and
password re-confirmation. Switching off the job that chases customers deserves
to feel like a settings change. The page gates read on `settings.view` and
every write on `settings.update`, rather than introducing a permission that
would need a migration to grant and a scoped `can()` case to avoid the
switch's `default: return true`.

**Only scheduled jobs record runs.** The nine reactive ones fire per
notification; a row each would duplicate the notifications table and bury the
signal. They are listed with their trigger so the inventory is complete, and
the page says plainly that they have no history and no switch — switching off
inbound email or the notification senders would silently break the product.

**Run history is pruned by the existing nightly cleanup** rather than a new
cron. The monitors fire every twenty minutes, so the table grows ~2k rows a
day; `housekeeping.run_history_days` caps it. One fewer job to explain.

**Recipients resolve from roles, named accounts and literal addresses**, in
that order of preference, and the UI says why: a role keeps working after a
handover, a named person does not. Deactivated accounts are dropped at send
time, so revoking someone's access stops their copy of company reporting
immediately rather than whenever someone remembers to edit the schedule.

**`buildReportDataset` moved out of the export route** into
`lib/reports/dataset.ts`, and `renderExport` out of `exportResponse`. Both are
now shared, so what arrives in the IT Director's inbox at 19:00 is the same
document someone else gets by clicking Export. When those two drift, people
stop trusting both.

**The registry is hand-maintained description of code elsewhere**, which is
the kind of thing that rots, so nine tests pin it against the actual function
files: no orphan ids, no unlisted function, triggers and `kind` matching the
real `cron()`/`eventType()` call, every setting key still in the registry,
every job having a name and description, and every tracked job actually wrapped
in `withAutomationRun` under its own id. Each check maps to a specific way the
panel could start lying to an operator.

---

## 2026-10-05 · Participants reach their ticket in the signed-in portal

A participant used to have exactly one way in: the guest link mailed to them.
Lose the email and the ticket was unreachable — it was not in `/portal/tickets`
and the direct URL 404'd — with no resend anywhere in the UI for them, the
requester, or staff.

**Why the one-line fix was wrong.** `ticket_participants` is keyed by EMAIL;
the portal is keyed by `tickets.customer_id`. Two identity spaces that were
never joined. Widening the portal query alone would surface the ticket and
then throw `ForbiddenError` out of `customerReply` the moment they typed a
reply, because `can()` collapses every customer-side ticket action to
`ticket.customerId === user.id`.

**How it works now.** `Target.ticket` gained `viewerIsParticipant`, following
the `viewerHasWorklog` precedent already in that type: a viewer-dependent flag
computed by the caller, so `can()` stays pure and DB-free. `loadTicketScope`
takes an optional `viewerUserId` and resolves the flag by joining participant
email to account email, lower-cased on both sides (participant rows are stored
lower-case; an account's address is stored as typed). The four customer-
reachable gates pass it: reply, upload, confirm-upload, download. Staff paths
omit it and are byte-for-byte unchanged.

**The grant is read + reply, nothing else.** Resolve, reopen, close, CSAT and
`manage_participants` all stay with the requester and staff. A participant is
ON the thread, not in charge of it. Seven cases in `can.test.ts` pin this, five
of them negative — those are what a too-broad grant would quietly hand over.

**The portal query is the part that could leak another customer's tickets**, so
its generated SQL was inspected driverlessly (`QueryBuilder.toSQL()`) rather
than trusted: the `exists` correlates on `tickets.id`, filters
`status = 'active'`, matches only the viewer's own address via a scalar
subquery, and `(owner OR participant) AND NOT draft` parenthesises correctly.

**Shared tickets are labelled, not blended.** `sharedWithMe` drives a badge in
the list and a line on the detail page naming whose ticket it is — otherwise a
colleague has no way to tell why they can read it but not change it. It is
derived in SQL (`customer_id IS DISTINCT FROM $viewer`) rather than compared in
the page, so there is one definition of "not mine".

**Also closed here, from the same review:** the pending-participant count now
appears on the coordinator dashboard (the queue was visible only to whoever
thought to open `/admin/moderation`); the submit form's colleague "Add" button
says why it refused instead of silently doing nothing; a failed invitation
email surfaces as a `warning` on an otherwise-successful result, from both the
add and the approve path, rather than being swallowed behind a flat success;
and `harvestRecipients` collects per-address failures so one bad address can
neither abandon the rest of the line nor erase the audit record of what landed.

---

## 2026-09-04 · Inngest app had not synced since launch: 7 of 17 functions were never registered

Follow-on from the 2026-09-03 entry below. That investigation concluded `process-customer-import-batch` wasn't registered with Inngest Cloud. Querying the Cloud API directly showed the problem was far wider:

```
functionCount: 10   lastSync: 2026-05-21T07:24:35Z   status: "success"
```

The app synced **once, at launch, and never again — 105 days.** Cloud knew 10 of the 17 functions in `src/inngest/functions/index.ts`. Never registered, therefore never run since May: `monthly-plan-reset` (so **no Monthly-Plan org balance has reset since launch**, req 8.2), `billing-balance-monitor`, `notify-accountant-resolved`, `unassigned-ticket-monitor`, `customer-followup-monitor`, `cleanup-stale-drafts`, and `process-customer-import-batch`. Additionally `sla-monitor` was still executing the **`*/5` schedule from May** rather than the `*/20` set in 1c3c39b (2026-06-18) — Cloud runs the config captured at sync time, so a changed cron is as stale as a missing function.

**Two things made this invisible for 105 days.** First, the Vercel–Inngest integration *was* installed and enabled the entire time; a failed automatic sync creates an "Unattached Sync" rather than alerting anyone. Second, `latestSync.status` read `"success"` throughout — it describes the last sync that happened, not whether the registry matches the deployed build. **Never health-check on that field; compare `functionCount` instead.**

Resolved by `curl -X PUT https://support.axiom360.it/api/inngest` (→ `{"message":"Successfully registered","modified":true}`, 10 → 17). The PUT branch takes no signature (`InngestCommHandler.js:1037`); the handler then authenticates outbound with its own signing key, so triggering a sync needs no credential — which is also why it must never be aimed at localhost while production keys are loaded, or the production app gets repointed at a laptop.

**Prevention added:** `.github/workflows/inngest-sync.yml` — syncs on Vercel's `repository_dispatch` after a production deploy, and, more importantly, **asserts on a daily schedule** that Inngest's `functionCount` equals the length of the exported `functions` array. Deliberately not triggered by `push`: CI runs while Vercel is still building, so a push-triggered sync would register the previous deployment's list and report success. Plus `pnpm inngest:sync` as break-glass.

**Rejected:** setting `appVersion` on the client — in inngest@4.3.0 it has 6 producers and 0 consumers outside `inngest/connect`; it is a field *in* a sync payload, never a trigger *for* one, and a hardcoded value can cause Cloud to *skip* a sync, reproducing this incident as its own fix. Also rejected: a `postbuild` sync script, which runs inside the build container before the deployment exists and would re-register the *previous* function list on a green build — worse than nothing, because it manufactures evidence the problem is handled.

---

## 2026-09-03 · Silent email failures: Resend errors were discarded, invite prep threw outside its own error handling, and the import wizard always claimed success

Reported symptom: importing a customer showed "Import queued", no invite email ever arrived, **Resend showed no send attempt at all**, and the Inngest dashboard said *"No function triggered by this event"* for `customer-import/batch.requested`.

**Root cause of THAT report is not in this codebase** — it's an Inngest Cloud registration gap. `process-customer-import-batch` is correctly defined (trigger string verified byte-identical to the emitted event name, and the installed SDK serializes it correctly) and correctly registered in `functions/index.ts`, but Inngest only registers functions on an inbound **PUT** to `/api/inngest` (`InngestCommHandler.js:1089`, inside `if (method === "PUT")`) — nothing registers on boot or on GET. The client sets no `appVersion`, so Cloud has no signal that would auto-resync, and the repo has no sync automation at all. `src/inngest/functions/index.ts` last changed in a4f8078 (2026-07-30) — the commit that took the array from 16 to 17 functions by adding this one. So an app whose last sync predates that deploy knows 16 functions and has no trigger for this event. Confirmed from live data: the imported customer's `users` row exists with **no roles**, and granting the Customer role is the *first* step inside the function (`provision.ts:198-224`) — so the function body never executed a single step. The fix is operational (resync the app, then replay the event; install the Vercel integration so it can't recur), not a code change.

Investigating it surfaced three genuine code defects, all fixed here — each one independently capable of producing "no email, no error anywhere":

1. **`sendEmail` discarded Resend's error result** (`lib/email/send.tsx`). The Resend SDK RETURNS `{data, error}` instead of throwing, so `await resend.emails.send(...)` with the result ignored made a *rejected* send — unverified sending domain, suppressed/invalid recipient, rate limit, bad API key — indistinguishable from a delivered one. Callers logged success, `users.inviteSendFailedAt` was never stamped, and the only evidence was an absence in the Resend dashboard. Now it throws on `error`, so the caller's try/catch and Inngest's retries actually see it. Audited the blast radius first: every `sendEmail` call site is inside a try/catch except `lib/auth/index.ts:204` (the magic-link sender), which is guarded one level up by `requestMagicLink` — whose catch block carries a comment about surfacing "silent send failures" that **could never fire before this change**, since nothing threw. This activates intended-but-dead error handling rather than introducing a new failure path.

2. **`sendCustomerSetupInvite` did its preparation outside its own error handling** (`lib/customer/invite.ts`). The settings read, the `invitedAt` stamp, the org lookup, `signCustomerInviteToken()` (throws without `CUSTOMER_INVITE_TOKEN_SECRET`) and `getAppUrl()` (**throws in production when `NEXT_PUBLIC_APP_URL` is unset** — and it is absent from `.env.local`) all sat above the try that wrapped only the send. A config problem therefore threw straight out of the function instead of returning `{ok:false}`: inside the bulk-import Inngest step that surfaced as a retried step and never stamped `inviteSendFailedAt`, leaving the row invisible to the Users list's "Failed to send" filter. All of it now runs inside a try that flags the row and returns `{ok:false}`.

3. **The import wizard asserted "queued" regardless of what happened** (`app/actions/customer-import.ts`, `components/users/customer-import-wizard.tsx`). `queuedCount` was computed *before* talking to Inngest, `inngest.send()`'s return value was discarded with no try/catch, and the action returned `{ok:true}` unconditionally. Because the stub `users` rows are committed *before* the send, a rejected enqueue is not "nothing happened" — it's "accounts exist, nobody was emailed, and nothing will retry." The result type now carries `enqueued` / `enqueueError` / `eventId`; a failed enqueue is audited as `user.bulk_import_enqueue_failed` and rendered as an amber warning that says accounts were created but no invitations were queued, and that re-importing the same file won't retry them (their emails now exist, so they'd be reported as duplicates). The success screen also shows the batch + event id for correlating against the Inngest dashboard, and finally renders `skippedRaceDuplicate`, which was computed and unit-tested but never displayed. Two new tests cover the accepted and rejected enqueue paths.

Deliberately NOT changed: `requestMagicLink` still swallows delivery failures in production and returns `{ok:true}` — that's an existing anti-enumeration decision, not an oversight, and it's now at least loggable in dev.

---

## 2026-09-03 · Service type moves to the ticket; admin-editable email copy; richer attachment preview

Four client-requested changes shipped together.

**1. Service type is a ticket-level field, not a per-work-log one.** New `tickets.service_type` (onsite | remote | **hybrid** — hybrid is new, `pnpm db:add-ticket-service-type`, default `remote` so every existing row has a value) set from a new "Service Type" sidebar card, mirroring the existing Type/Category control pattern (`setTicketServiceType` + `TicketServiceTypeControl`, both gated on `tickets.update` — no new permission). The per-entry picker is gone from BOTH work-log surfaces: the ticket-detail card and the `/admin/work-log` "Add time" modal (which now shows the chosen ticket's service type read-only instead). `addWorkLogEntry` no longer accepts `serviceType` from the client at all — it stamps the ticket's current value server-side.

The non-obvious call: **a work-log row's `service_type` is a frozen snapshot**, not a live join. Editing a ticket's service type later does NOT rewrite past entries, and `updateWorkLogEntry` never touches the column — same reasoning as `work_logs.technician_name` and `messages.author_name` being point-in-time snapshots. An hour logged as remote work stays logged as remote work even if the ticket later becomes hybrid, because that's what actually happened. `work_logs.service_type`'s CHECK was widened to accept `hybrid` so a snapshot can hold it. Sidebar labels were also renamed Type → **Ticket Type** and Category → **Ticket Category** (i18n strings only) so three adjacent cards don't read ambiguously.

**2. Email copy is admin-editable (Settings → Email templates, §25.1).** All 33 email message namespaces, plain-text fields only. Chosen shape and why:
- **Override the existing i18n keys, don't template raw HTML.** Every template already renders from named keys; a sparse `email_template_overrides` table stores only reworded fields, so no row = compiled-in default, "reset" = DELETE, and a fresh DB behaves exactly as before. Nothing about the React Email layout is admin-editable — that keeps a wording change from being able to break an email's markup or open an HTML-injection surface in outbound mail.
- **Rich-text keys are excluded, not validated.** `emails.ticketResolved.viewLine` (the only `t.rich` key in the codebase) embeds markup bound to a React element; there's no safe way to let free text reproduce that, so it simply isn't offered.
- **Wiring is a wrapper, not a rewrite.** `withEmailOverrides(templateKey, locale, translator)` takes the translator each template already built — so every call site keeps next-intl's compile-time message-key checking verbatim — and returns a **Proxy** whose apply trap consults overrides while `.rich`/`.markup`/`.raw`/`.has` pass through with their original `this`. A codemod applied the one-line wrap to all 33 files; `defaultSubject()` in `send.tsx` got it too, since subjects render there rather than inside the component.
- **Placeholder safety is asymmetric on purpose:** a save is rejected if it introduces a `{token}` the default didn't have (nothing would substitute it, so it would ship as literal `{foo}` to a customer), but dropping a token the default used is allowed — the admin's wording may legitimately not need it.
- Editable FIELDS are derived from the message catalog at runtime, so adding a key to a template's namespace makes it editable with no second list to drift. Gated on `settings.update` + the same fresh-password re-auth as `updateSetting`, audited, and deliberately **not** exposed over MCP (consistent with `update_setting` being refusal-only there).

**3. Attachment preview extended.** Images (lightbox) and PDFs (paginated modal) already previewed in-app; video now opens an in-app player and Office documents open a modal that says preview isn't available and offers the download, rather than silently punting to a new browser tab. Office formats have no in-browser renderer without a third-party conversion service, so "open in the app and explain" beat either shipping a broken preview or leaving the silent new-tab fallback.

**Found while doing this — `file_upload.allowed_mime_types` is a dead setting.** The real upload gate is the hardcoded `ALLOWED_MIME_TYPES` set in `lib/storage/mime.ts`; `getAttachmentLimits()` only reads the size/count keys, and nothing anywhere reads the MIME list. The two had drifted: `video/mp4` was in the seeded setting (and in `magic-bytes.ts`) but NOT in the hardcoded set, so video uploads were being rejected outright — which would have made the new video preview unreachable. Fixed minimally by adding `video/mp4` to the hardcoded set; wiring the setting up to actually drive the gate is left as a separate change rather than folded in here, and is now flagged in README §25.

**4. Customer import wizard** gained a field-requirements table and a "Download template" button (client-side Blob CSV matching the exact 3 columns the parser reads). Purely additive — the existing paste/upload textarea is untouched.

---

## 2026-09-30 · Multiple people on a ticket (participants)

A ticket is now a thread several people can be on, not just the requester. The
`ticket_participants` table already existed (external contributors picked up
from inbound email, CC'd on future updates) but was only reachable from the
inbound pipeline and the moderation queue — there was no UI anywhere, and no
way to put someone on a ticket deliberately.

**The four ways someone joins, and what gates each:**

| Source | `added_via` | Lands as | Gate |
|---|---|---|---|
| Staff type an address | `agent` | active | staff *are* the approval gate |
| Requester picks a colleague | `requester` | active | same org only, by id |
| Guest types an address | `guest_request` | **pending** | staff approval |
| Inbound To/Cc | `domain_auto` / `recipient` | active if the org's own domain, else **pending** | sender auth + org domain |

**Why `pending` is a status on the existing table**, not a queue of its own:
every existing read path already filters `status='active'`, so a pending row is
inert with zero changes to `listActiveParticipants`, the CC loop, or the thread
badge — and `unique(ticket_id, email)` dedupes repeat requests for free. It was
tempting to mint a held `messages` row instead (the moderation queue holds
messages), but that would pollute the loop detector, subject/sender threading
and the thread view with a message nobody sent.

**`tickets.manage_participants` is a new permission, not `tickets.update`.** The
requesting customer holds it, scoped in `can()` to their own ticket; handing
them `tickets.update` instead would also hand them status, priority, category,
billable and the invoice number. The danger with a new constant here is that
`can()`'s switch ends in `default: return true` — a constant without a matching
scoped case grants it on every ticket the caller can see. It is in the
ticket-scope group, plus a new `isNonStaff` leg, because `isStrictCustomer`
requires Customer to be the user's ONLY role: a customer holding some harmless
extra role isn't "strict" and would otherwise have fallen straight through.

**Approval is `tickets.update` — staff only.** Gating it on
`manage_participants` would have let a guest approve the very strangers they
proposed, making the approval step decorative. Two independent review lenses
flagged this; it is the single most important line in the feature.

**`created_by_email` (new column) anchors creator rights.** `created_by_id` is
NULL on exactly the guest and inbound tickets where it matters and is documented
as visibility-not-attribution; `customer_email` is rewritable by
`setTicketCustomer`, which would silently transfer creator rights to whatever
address it was pointed at. Backfilled from `customer_email` (400 rows) — that
address has been able to act on the ticket via its guest link since the day it
was raised, so it grants nothing new. On `createTicketOnBehalf` the creator is
the CUSTOMER it is for, not the staff member who keyed it in, so the column
means one thing on every row.

**`harvestParticipant` vs `upsertParticipant` is the removal tombstone.**
`upsertParticipant` sets `status:'active'` unconditionally — right for a
deliberate human re-add, catastrophic for an automatic path: one inbound email
would put back someone a coordinator removed, and would keep doing it on every
later email. Every non-staff path now goes through `harvestParticipant`
(`onConflictDoNothing` for pending; `setWhere: status <> 'removed'` for active).
Only two `upsertParticipant` callers remain, both explicit human acts.

**Guest links prove WHICH address you are, not that you created the ticket** —
every approved participant gets a token minted for their own address. So
`resolveGuestActor` (new) is the single gate for all four guest surfaces (view,
reply, download, upload), and creator-only actions compare against
`created_by_email`. Bad token, unknown ticket and "not on this thread" return
one indistinguishable response, or the difference is an oracle. This also fixed
two latent bugs: a participant's reply would have been attributed to the
REQUESTER's name, and `resolveUploadAuthorization`'s hand-rolled check would
have given them a composer whose attach button always failed. `getGuestTicket`
was deleted once unused — leaving a weaker email-scoped lookup next to the new
one is how a regression gets written later.

**Inbound harvesting is last and most guarded**, behind `inbound_harvest_cc`
(default on). Bcc is out of scope permanently: mail servers strip it, so the
field is effectively always empty, and surfacing it would betray what the sender
chose to hide. The raw `Cc:` header is the primary source (the structured `cc`
array is often absent from the metadata-only webhook); `ccEmails` is OPTIONAL on
`NormalizedInboundEmail` because events queued before it existed are already in
Inngest and arrive without the key. Four guards, each closing a real hole an
adversarial review pass found:
- the new-ticket path computes `senderAuthVerdict` ITSELF — nothing upstream
  checks the From there, and a failing verdict forces every address to pending;
- the reply path is guarded `relation !== "foreign"`, or a stranger could
  nominate recipients whenever moderation is switched off;
- a shared self-address filter (support address, inbound domain,
  `ticket+NUMBER@`) runs on every write path, not just this one — the To line of
  every inbound ticket email contains one of ours;
- free-mail domains can never auto-join, so one bad `organization_domains` row
  (someone registering gmail.com) can't turn CC harvesting into an open
  subscription.

**Notification on joining** is sent when a HUMAN causes the transition to active
(staff add, requester pick, coordinator approval) — never for a pending row
(nobody has vouched for it and the subject line alone leaks the topic) and never
for an inbound auto-join (they just emailed in about it).

Migrations: `pnpm db:add-ticket-created-by-email`,
`pnpm db:add-participant-permission`, `pnpm db:add-participant-pending`.

---

## 2026-09-03 · Production bug: inbound emails silently dropped — content fetch moved out of the webhook route

Reported symptom: some inbound emails (both direct and forwarded) never created or threaded a ticket. Resend's own delivery log for the `email.received` webhook showed a 500 response with body **"Enqueue failed"** for the affected deliveries, retried and failing identically every time.

**Root cause.** `app/api/email/inbound/route.ts` used to call `fetchResendInboundContent(emailId)` (Resend's inbound webhook is metadata-only — body/headers must be fetched separately via `GET /emails/receiving/{id}`) and inline the full `text`/`html`/`headers` into the `email/inbound.received` event before calling `inngest.send()`. Inngest enforces a per-event payload cap — **256KiB (Free) / 512KiB (Basic) / 3MiB (Pro)** — and a long Outlook `Fw:`/`Re:` thread carrying several **inline** images (the two reported cases: a 3-inline-image forward and a 21-inline-image reply chain) routinely produces bloated HTML (MSO conditional markup, accumulated quoted history) that exceeds it. `inngest.send()` then throws, the route's catch block rolls back the idempotency row and returns `500 "Enqueue failed"` (`route.ts` line ~150 at the time) — deterministic, so every one of Resend's automatic redelivery attempts fails the same way and the email is permanently lost from the app's point of view unless someone notices it in Resend's dashboard. Short plain-text emails stayed under the cap and worked fine, which is why this only affected "some" emails.

**Fix.** Moved the content fetch out of the webhook route and into `process-inbound-email` itself, inside a `step.run("fetch-email-content", …)` at the very top of the function (before ticket-number/thread resolution, since those also read `payload.headers`). The route now only calls `normalizeResendInbound` on the raw (still metadata-only) payload — just enough to confirm there's a real sender — before enqueueing; the event it sends carries no `text`/`html`/`headers` at all, so its size is now a small, fixed footprint regardless of the email's actual content. A plain outbound `fetch()` from inside an Inngest function has no comparable size ceiling. A transient Resend API failure inside the step throws, which Inngest retries per this function's existing `retries: 2` — the same "never silently lose a reply" guarantee the old webhook-side 500-and-rely-on-Resend's-redelivery approach was going for, just via a retry channel we actually control instead of depending on Resend to keep retrying a webhook delivery. The `"Content fetch failed"` 500 path in the route is gone entirely (nothing left there to fail on that axis).

**Not fixed by this change:** the two specific customer emails reported (from `e.rueca@axiom360.it` and `mwilson@golfcanada.ca`) already exhausted Resend's redelivery attempts before the fix shipped — they need to be manually recreated as tickets (or replayed from Resend's dashboard if it offers a manual redelivery action for a past event) since Resend won't retry a delivery it's already given up on.

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
