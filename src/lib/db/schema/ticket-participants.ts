import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { tickets } from "./tickets";

// ── Ticket participants / watchers (req 5.2) ──────────────────────────
//
// External email addresses (NOT staff users) recognized as legitimate
// contributors to a ticket beyond the original requester — e.g. a colleague
// the customer forwarded the ticket to, who replied from a different address
// in the SAME organization. They are added automatically when an org-domain
// reply is accepted (`added_via='domain_auto'`) or by a coordinator approving
// a held message (`added_via='moderation'`). Active participants are CC'd on
// future ticket emails so updates reach them too. This is distinct from
// `ticket_assignees` (internal staff co-assignees, users-FK only).
// ──────────────────────────────────────────────────────────────────────

export const ticketParticipants = pgTable(
  "ticket_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    // Lower-cased email of the external contributor.
    email: text("email").notNull(),
    name: text("name"),
    // domain_auto | moderation | agent | requester | guest_request | recipient
    // (see ParticipantAddedVia in lib/tickets/participants.ts)
    addedVia: text("added_via").notNull().default("domain_auto"),
    // The staff member who added them (moderation/manual), null for auto.
    addedById: uuid("added_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // pending = proposed but not yet approved (guest-typed, or harvested from
    // an inbound To/CC where the sender isn't recognized). Every existing read
    // path filters status='active', so a pending row is inert until approved.
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    unique("ticket_participants_ticket_email_key").on(t.ticketId, t.email),
    index("ticket_participants_ticket_id_idx").on(t.ticketId),
    check(
      "ticket_participants_added_via_check",
      sql`${t.addedVia} IN ('domain_auto','moderation','agent','requester','guest_request','recipient')`,
    ),
    check(
      "ticket_participants_status_check",
      sql`${t.status} IN ('pending','active','removed')`,
    ),
  ],
);
