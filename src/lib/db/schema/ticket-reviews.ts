import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { tickets } from "./tickets";

// ── Customer satisfaction reviews (CSAT emoji feedback) ────────────────
//
// When a ticket is resolved the customer is asked for a one-tap rating on a
// three-point emoji scale — happy (😊) / neutral (😐) / unhappy (☹️):
//   - happy   → ticket closes; comment optional
//   - neutral → ticket closes; comment optional
//   - unhappy → ticket REOPENS; comment MANDATORY
//
// Each response is recorded here as an append-only review row so we keep the
// full history (a ticket can be resolved → rated unhappy → reopened → resolved
// → rated again) and can attribute every rating to BOTH the ticket and the
// technician who owned it at the time. The technician name is snapshotted
// (mirrors `work_logs.technician_name`) so a removed/reassigned tech's reviews
// stay attributable. `tickets.csat_rating` / `csat_response` hold the LATEST
// response for the close/reopen state machine + quick reporting; this table is
// the source of truth for the per-technician CSAT stats and the comments.
// ──────────────────────────────────────────────────────────────────────

export const ticketReviews = pgTable(
  "ticket_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      // Tickets are soft-deleted (restrict), matching messages/work_logs.
      .references(() => tickets.id, { onDelete: "restrict" }),
    // happy | neutral | unhappy — enforced by the CHECK below.
    rating: text("rating").notNull(),
    // Free-text feedback. Required at the app layer for `unhappy`, optional
    // otherwise; nullable in the DB so a happy one-tap needs no comment.
    comment: text("comment"),
    // The technician who owned the ticket when the review landed (the primary
    // assignee). Nullable — an unassigned ticket can still be rated.
    technicianId: uuid("technician_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Snapshot of the technician's name at review time so the attribution
    // survives reassignment / user removal (technician_id → null).
    technicianName: text("technician_name"),
    // Lower-cased email of the responder (the ticket's customer).
    respondentEmail: text("respondent_email").notNull(),
    // The customer's user id when they responded from the authenticated
    // portal; null for a guest responding via the email link.
    respondentId: uuid("respondent_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Where the rating came from: 'portal' (in-app) or 'email' (link).
    submittedVia: text("submitted_via").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("ticket_reviews_ticket_id_idx").on(t.ticketId),
    index("ticket_reviews_technician_id_idx").on(t.technicianId),
    index("ticket_reviews_created_at_idx").on(t.createdAt.desc()),
    index("ticket_reviews_rating_idx").on(t.rating),
    check(
      "ticket_reviews_rating_check",
      sql`${t.rating} IN ('happy','neutral','unhappy')`,
    ),
    check(
      "ticket_reviews_submitted_via_check",
      sql`${t.submittedVia} IN ('portal','email')`,
    ),
  ],
);
