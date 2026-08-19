# Notification matrix (role-based routing)

Requirements 6.1–6.4. This is the authoritative map of **which role receives
which notification, on which channels**, and why. Keep it in sync with:

> **2026-08-19 — Coordinator + Super Admin now see every staff-facing event.**
> `src/lib/notifications/audience.ts`'s `OVERSIGHT_ROLES = ["Coordinator",
> "Super Admin"]` is now included on every staff-facing dispatch that
> previously reached only one of them, or only as an unassigned/no-staff
> fallback. This is a deliberate deviation from several of this doc's
> original per-event rules (fallback-only routing, Super-Admin-only
> oversight) — see DECISIONS.md for the rationale. IT Director's reach is
> unchanged. Customer-facing events are unchanged. The rows below reflect
> the *current* behavior, not the original design.

- `src/inngest/client.ts` — `NotificationEventType` union
- `src/lib/notifications/registry.ts` — in-app title/body per event type
- `src/lib/notifications/audience.ts` — which events each role may TUNE in their profile
- every `notification/dispatch` producer (see "Producers" below)

## Principles

1. **One event type = one audience's wording.** The in-app bell renders text
   from `registry.ts` keyed *only* by event type. So an event delivered to two
   different audiences would show identical text to both. Therefore an event
   that needs different wording per audience is **split into two event types**
   (e.g. `ticket.assigned_customer` for the customer vs `ticket.assigned` for
   the technician). Never reuse one type across customer + staff.
2. **Links match the recipient's app.** Customer notifications link to
   `/portal/...`; staff notifications link to `/admin/...`. A customer must
   never receive an `/admin/...` link.
3. **Email templates match the recipient's voice.** A staff "the customer
   replied" email must not reuse the customer-facing "an agent replied to *your*
   ticket" template.
4. **No silent drops.** If a ticket is unassigned, ticket events fall back to
   the **Coordinator** queue rather than notifying no one.
5. **Channels are gated by preference.** Email/SMS are sent only if the
   recipient's `notification_preferences` allow it (default on). In-app is
   always inserted when the event type has a registry descriptor.

## Roles

`Super Admin`, `IT Director`, `Coordinator`, `Technician`, `Customer`
(`src/lib/db/seed.ts`). Customers are users with a notification bell + a
preferences page, exactly like staff.

## Per-role matrix

Channels: **E** = email, **S** = SMS, **A** = in-app (bell). "(direct)" = sent
via `sendEmail` rather than the dispatcher (no bell entry, no pref gate — used
for guests/transactional confirmations).

### Customer (ticket owner)

| Event | Channels | Notes |
|---|---|---|
| `ticket.assigned_customer` | E·S·A | "Your ticket has been assigned" — names the technician (6.2). NOT the tech's "assigned to you". |
| `ticket.agent_replied` | E·S·A | The team replied. |
| `ticket.resolved` | E·S·A | Resolved — confirm to close. |
| `ticket.reopened` | E·S·A | Reopened. |
| `ticket.closed` | E·A | Closed. |
| `ticket_created` | E (direct) | Submission confirmation. |
| `attachment_removed_customer` | E (direct) | Their own upload failed the virus scan — portal link, no signature detail. |

Guest (no account) submitters get the **direct-email** equivalents of the
above (assigned / reply / resolved / reopened / closed / created); no bell, no
SMS. A customer **never** receives: `ticket.assigned` (tech copy),
`ticket.customer_replied`, `ticket.message_held`, `ticket.csat_unsatisfied`,
`ticket.escalated`, `ticket.reassigned`, `sla.*`, `procurement.*`, or the staff
`attachment.quarantined`.

### Technician (the assignee)

| Event | Channels | Notes |
|---|---|---|
| `ticket.assigned` | E·S·A | "Assigned to you" — `new_assignment` email, `/admin` link. |
| `ticket.customer_replied` | E·S·A | Staff-voiced `customer_replied_staff` email (not the customer template). |
| `ticket.csat_unsatisfied` | E·A | Customer rejected the resolution. Also goes to Coordinators. |
| `sla.warning_50` | A | Heads-up. |
| `sla.warning_80` | S·A | Approaching breach. |
| `sla.breached` | E·S·A | Breached — `sla_breached_staff` email + SMS + bell. Also broadcast to Super Admin + IT Director + Coordinator. |
| `attachment.quarantined` | E·A | Infected upload on their ticket — `/admin` link, signature detail. |

### Coordinator (triage / queue owner)

| Event | Channels | Notes |
|---|---|---|
| `ticket.created` | E·S·A | **New ticket arrived** (portal / guest web form / inbound email) — broadcast for triage/assignment. Also goes to IT Director + Super Admin. Fired by `dispatchTicketCreated` from all three customer create paths. |
| `ticket.closed_staff` | E·S·A | A ticket was **closed** (CSAT-confirmed or auto-closed after 24h) — oversight copy, also to IT Director + Super Admin. Fired by `dispatchTicketClosedStaff` from the CSAT-confirm + auto-close paths (separate from the customer-facing `ticket.closed`). |
| `ticket.unassigned_reminder` | E·A | A ticket has sat **unassigned** past the threshold — recurring nudge (with IT Director + Super Admin). Settings-driven (`unassigned_alert.*`); fired by the unassigned-ticket monitor cron. |
| `ticket.reassigned` | E·S·A | **Always**, oversight — added 2026-08-19 (previously Super Admin only). |
| `ticket.customer_replied` | E·S·A | **Always** (alongside the assignee, when there is one) — added 2026-08-19 (previously unassigned-only fallback). |
| `ticket.message_held` | A | Inbound reply from outside the org held for moderation (5.2). Toggleable in the profile grid as of 2026-08-19 (previously not tunable at all). |
| `ticket.csat_unsatisfied` | E·A | Always (alongside the assignee). |
| `ticket.escalated` | E·S·A | **Always**, oversight — added 2026-08-19 (previously only the default target / explicitly-selected target). |
| `procurement.submitted` | E·S·A | New procurement request to action. SMS added 2026-08-19. |
| `procurement.delivered` | E·S·A | **Always**, oversight — added 2026-08-19 (previously only the individual requester). |
| `sla.warning_*` | A (+S at 80% if it became the de-facto owner) | Warnings only when the ticket is **unassigned** (fallback) — unchanged. |
| `sla.breached` | E·S·A | **Always** on breach (assigned or not) — oversight, alongside Super Admin + IT Director + the assignee. |
| `attachment.quarantined` | E·S·A | **Always**, oversight — added 2026-08-19 (previously only when no assignee/staff uploader was attributable). SMS added 2026-08-19. |

### IT Director

| Event | Channels | Notes |
|---|---|---|
| `ticket.created` | E·S·A | New ticket arrived — broadcast for triage/awareness (with Coordinator + Super Admin). |
| `ticket.closed_staff` | E·S·A | A ticket was closed — oversight (with Coordinator + Super Admin). |
| `ticket.unassigned_reminder` | E·A | Ticket left **unassigned** past the threshold — nudge (with Coordinator + Super Admin). |
| `ticket.escalated` | E·S·A | Default escalation target (with Coordinator) and when explicitly selected. |
| `sla.breached` | E·S·A | **Always** on breach — oversight (with Super Admin + Coordinator + the assignee). |

### Super Admin

| Event | Channels | Notes |
|---|---|---|
| `ticket.created` | E·S·A | New ticket arrived — broadcast for oversight (with Coordinator + IT Director). |
| `ticket.closed_staff` | E·S·A | A ticket was closed — oversight (with Coordinator + IT Director). |
| `ticket.unassigned_reminder` | E·A | Ticket left **unassigned** past the threshold — nudge (with Coordinator + IT Director). |
| `ticket.reassigned` | E·S·A | Every true reassignment, oversight (req 3.2). Coordinator also always included as of 2026-08-19. |
| `ticket.customer_replied` | E·S·A | **Always** (alongside the assignee, when there is one) — added 2026-08-19. |
| `ticket.csat_unsatisfied` | E·A | Always (alongside Coordinator + the assignee) — added 2026-08-19. |
| `ticket.escalated` | E·S·A | **Always** — Super Admin receives every escalation for oversight (in addition to the chosen target / the IT Director + Coordinator default; Coordinator also always included as of 2026-08-19). |
| `procurement.submitted` | E·S·A | New procurement request to action — added 2026-08-19 (previously Coordinator only). |
| `procurement.delivered` | E·S·A | **Always**, oversight — added 2026-08-19 (previously only the individual requester). |
| `attachment.quarantined` | E·S·A | **Always**, oversight — added 2026-08-19 (previously only Coordinator, and only as a no-staff-attributable fallback). |
| `sla.breached` | E·S·A | **Always** on breach — Super Admin receives every SLA breach for oversight (with IT Director + Coordinator + the assignee). |

`targetRole` for escalation is validated server-side against
`{IT Director, Coordinator, Super Admin}` so a client can't broadcast a
staff-worded escalation to an arbitrary role (e.g. `Customer`).

### Procurement requester (the staff member who raised the request)

| Event | Channels | Notes |
|---|---|---|
| `procurement.delivered` | E·S·A | Routed through the dispatcher (honors prefs + bell). SMS added 2026-08-19. A requester with no user account (legacy/guest) additionally gets a direct fallback email outside the dispatcher. |

## Preference scoping

`src/lib/notifications/audience.ts` defines `STAFF_EVENT_TYPES` and
`CUSTOMER_EVENT_TYPES`. Each profile page shows only its audience's events; the
write validator (`updateNotificationPreference`) accepts the **union**, so a
customer can tune a customer event without it appearing in the staff grid, and
vice-versa. `OVERSIGHT_ROLES = ["Coordinator", "Super Admin"]` (added
2026-08-19) is the always-CC list layered on top of this scoping — it doesn't
change who may *tune* an event, only who's a resolved recipient at dispatch
time, so it composes with everything above: a Coordinator/Super Admin who
doesn't want a given event can still turn off email/SMS for it in their own
profile, same as anyone else.

## Producers

`tickets.ts` (assign/reassign/reply/resolve/reopen/escalate),
`customer-portal.ts` (customer reply, CSAT), `moderation.ts` (approve held),
`procurement.ts` (submitted/delivered), `csat/confirm/route.ts`,
`auto-close-resolved.ts` (closed), `sla-monitor.ts` (SLA),
`scan-attachment.ts` (quarantine), `process-inbound-email.ts` (inbound reply,
held), `unassigned-monitor.ts` (unassigned reminder). The MCP write tools
(`lib/mcp/tickets-write.ts`, `lib/mcp/procurement-write.ts`) mirror the
Server Action producers for their respective events. All emit
`notification/dispatch`; `dispatch-notification.ts` fans out to
email/SMS/in-app.
