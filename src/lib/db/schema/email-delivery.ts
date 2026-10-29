import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// ── Addresses our email provider will not deliver to ──────────────────
//
// Resend keeps a suppression list. After one hard bounce or one spam
// complaint it silently refuses every future send to that address — and still
// reports the send as a success. So "the email went out" and "the person got
// it" had come apart with nothing in this system noticing: a customer was
// shown every update in the portal, never received a single one in her inbox,
// and nobody knew.
//
// This table is what the delivery monitor learns from Resend's own log. One row
// per address, kept up to date; a row with `resolved_at` set is history (a later
// message was delivered), and one without is a problem someone should look at.
//
// Keyed by ADDRESS, not by user: the people affected include guests and ticket
// participants who have no account.

export const emailDeliveryIssues = pgTable(
  "email_delivery_issues",
  {
    /** Lower-cased. */
    email: text("email").primaryKey(),
    /** suppressed — Resend refused it because the address is on its list
     *  bounced    — the recipient's server permanently rejected it
     *  complained — the recipient marked a message as spam */
    status: text("status").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    /** Resend's id for the most recent affected message, so the dashboard link
     *  can open it directly. */
    lastEmailId: text("last_email_id"),
    lastSubject: text("last_subject"),
    /** Set when a LATER message to this address was delivered. */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "email_delivery_issues_status_check",
      sql`${t.status} IN ('suppressed','bounced','complained')`,
    ),
    // Almost every read is "open issues", and almost every row is resolved or
    // old — a partial index keeps that lookup tiny.
    index("email_delivery_issues_open_idx")
      .on(t.lastSeenAt)
      .where(sql`${t.resolvedAt} IS NULL`),
  ],
);
