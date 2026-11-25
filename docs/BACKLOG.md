# Backlog

Work we have agreed is worth doing but have deliberately not started. Newest
first. Move an item into DECISIONS.md (with the reasoning) when it is done.

---

## Dashboard: what is left after phase 2

**Phase 1 (widget system) and phase 2 (14 on-demand chart widgets) are built; see
DECISIONS.md.** Still open:

- A date-range control per widget (7 / 14 / 30 / 90 days); today each uses a fixed window
- Stop loading data for hidden *older* panels (My Queue, SLA, escalations, triage,
  plan watch, CSAT, the three original charts); they render server markup, so this
  needs them split into data + presentation first
- Keyboard repositioning (move up / down buttons); arranging is drag-only today
- More widgets: unassigned ticket age; reopen rate; plan-hours consumption per
  organization; tickets per co-assignee; a ratio that is not over a fixed window
- "Per person" counts the primary assignee only; decide whether co-assignees count
- A dashboard-wide "last N days" switch, if per-widget ranges prove fiddly

---

## Move background jobs off Inngest, onto Vercel Cron

**Added 2026-11-25. Status: parked by the product owner, not scheduled.**

**Why.** Inngest's Hobby plan is exhausted, so it drops ~90% of scheduled runs
(24h to 2026-11-24 19:51Z: `sla-monitor` 7 runs of 72 due, `unassigned-ticket-monitor`
10 of 72, `customer-followup-monitor` 2 of 4). Reminders, auto-closes and SLA
alerts arrive days late. History and diagnosis: DECISIONS.md, entries
"2026-11-24 · "Awaiting customer" tickets the monitor skipped…" and
"2026-11-10 · Inngest Hobby plan exhausted…".

**Scope (22 Inngest functions, `src/inngest/functions/`).**

| Group | Count | Replace with |
|---|---|---|
| Scheduled jobs (SLA, unassigned, follow-up, auto-close-resolved, 3 rule dispatchers, scheduled reports, email-delivery, monthly reset, 3 cleanups) | 13 | One `/api/cron/<job>` route each + `vercel.json` `crons`; keep the job body, replace `step.run` with the direct shim already used by `process-inbound-direct.ts` |
| Inbound email + notification dispatch/email/SMS/in-app | 5 | Already run in-process; delete the Inngest fallback |
| Billing alerts (`billing-balance-monitor`, `notify-accountant-resolved`) | 2 | Direct call from `after()` |
| Virus scan (`scan-attachment`) | 1 | `after()` after upload + a cron that re-scans rows left `pending` |
| Customer import (`process-customer-import-batch`) | 1 | Cron that processes a few rows per tick from the already-saved stub rows |

Last step: remove the `inngest` package, `/api/inngest`, `inngest-sync.yml`
and the Inngest env vars.

**Facts checked against Vercel's docs on 2026-11-24** (re-check before starting;
Cron is flagged legacy, moving to "Schedules"):
- Cron is included on all plans. Pro: min interval once per minute, per-minute
  precision, 100 cron jobs per project. GET to the production deployment only.
- Each run is a normal function invocation. Pro includes no CPU/memory/invocation
  allowance (the table says N/A); the $20/month Pro credit offsets usage.
  Invocations $0.60 per million; Active CPU $0.128/h and memory $0.0106/GB-h in
  iad1.
- Functions: 300s default, 800s max on Pro.
- Cron does NOT retry, delivery is best effort (a run can be missed or doubled),
  runs can overlap, no redirects, `CRON_SECRET` is read at deploy time.
- Our estimate: ~10,300 runs a month, about $1.30 a month.

**Rules for the move.** Every job must be safe to run twice or be skipped
(audit each; the follow-up monitor already claims work atomically). Move one
group at a time, remove Inngest last.

Docs:
- https://vercel.com/docs/cron-jobs/usage-and-pricing
- https://vercel.com/docs/cron-jobs/manage-cron-jobs
- https://vercel.com/docs/functions/limitations
- https://vercel.com/docs/functions/usage-and-pricing
- https://vercel.com/docs/plans/pro-plan
