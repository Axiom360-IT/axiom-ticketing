// ── Customer follow-up clock ──────────────────────────────────────────────
//
// The follow-up monitor reminds a customer, then auto-closes, when a ticket
// sits in `awaiting_customer_confirmation`. Two questions decide whether and
// from when it does that; both live here as pure functions so they can be
// tested without a database or Inngest.
//
//   1. Does the customer owe a reply?
//   2. When did the waiting START? (the reminder / close schedule counts from it)
//
// Previously the answer to (1) was "only if an agent wrote the last visible
// message", and to (2) "when that message was written". That left two holes:
//
//   * Staff park a ticket with the status dropdown WITHOUT replying. The latest
//     visible message is then the customer's original email, so the monitor
//     skipped the ticket forever (6 such tickets were found stuck for up to 18
//     days, 2026-11-24).
//   * A ticket the agent last wrote on days ago and only parked now counted its
//     5 days from that old message, so it was reminded and then closed within
//     one cron tick.
//
// The status dropdown (and the MCP status tool) stamp `tickets.sla_paused_at`
// when a ticket ENTERS a pause status, which is exactly "when the waiting
// started". A customer reply clears it (resumeFromAwaitingCustomer).

export type FollowupInput = {
  /** Author of the latest customer-visible, approved, NON-system message. */
  lastAuthor: string | null;
  lastAt: Date | null;
  /** `tickets.sla_paused_at` — when the ticket was parked, if it was. */
  parkedAt: Date | null;
};

/**
 * The instant the customer's wait began, or null when the customer does NOT
 * owe a reply (so the monitor must leave the ticket alone).
 *
 *   agent spoke last          → the later of that message and the parking
 *                               (an old agent message must not pre-date a
 *                               ticket that was only parked now)
 *   customer spoke last       → owes a reply only if the ticket was parked
 *                               AFTER that message; the wait began when parked
 *   customer spoke last, and the ticket was not parked after it
 *                             → they already answered; not waiting on them
 *   no visible message at all → the parking time, if there is one
 */
export function followupClockStart(i: FollowupInput): Date | null {
  const { lastAuthor, lastAt, parkedAt } = i;

  if (!lastAt) return lastAuthor === null ? parkedAt : null;

  if (lastAuthor === "agent") {
    return parkedAt && parkedAt.getTime() > lastAt.getTime() ? parkedAt : lastAt;
  }
  if (lastAuthor === "customer") {
    return parkedAt && parkedAt.getTime() > lastAt.getTime() ? parkedAt : null;
  }
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The close date quoted in the reminder email. Normally the scheduled close
 * (clock + followup + close days). A ticket already past that — a backlog the
 * monitor is only now picking up — would otherwise be told it closes on a date
 * in the past, so it is quoted at least a day out; the monitor holds the close
 * back to match (see MIN_NOTICE_MS).
 */
export function quotedCloseAt(
  clockStart: Date,
  now: Date,
  followupDays: number,
  closeDays: number,
): Date {
  const scheduled = clockStart.getTime() + (followupDays + closeDays) * DAY_MS;
  return new Date(Math.max(scheduled, now.getTime() + DAY_MS));
}

/**
 * A ticket is never closed within this long of its latest reminder, so the
 * customer always has about a day between "we'll close it" and the close.
 * Shorter than 24h on purpose: with the 6-hourly cron, a reminder at 12:00
 * still lets the close land on the 12:00 run a day later, and a daily
 * reminder sent the day before the close doesn't push it back.
 */
export const MIN_NOTICE_MS = 20 * 60 * 60 * 1000;
