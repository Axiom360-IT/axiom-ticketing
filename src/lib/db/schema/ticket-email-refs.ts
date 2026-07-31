import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tickets } from "./tickets";

// ── Email Message-ID ↔ ticket index (RFC 5322 threading) ─────────────────
//
// Robust inbound threading. Today a reply only threads to its ticket when the
// ticket NUMBER is present in the To (`ticket+NUM@…`) or subject (`[NUM]`).
// That fails when a customer replies inside their ORIGINAL mail thread (whose
// subject predates the ticket and carries no number) or to a staff member's
// raw Outlook reply — the message then opens a duplicate ticket instead of
// landing in the thread (see the "ice cream cart rental" 4-ticket case).
//
// This table records the RFC `Message-ID` of every email we see for a ticket
// (inbound customer/agent emails, and our own outbound notifications). On a
// new inbound email with no number token, we scan its `In-Reply-To` +
// `References` headers — which accumulate the whole thread's Message-IDs — and
// match any against this table to recover the ticket. Because `References`
// carries the ORIGINAL message's id, even a reply to an out-of-band Outlook
// message still resolves correctly.
export const ticketEmailRefs = pgTable(
  "ticket_email_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    // Normalized RFC Message-ID: angle brackets stripped, trimmed, lowercased.
    // Unique so a given Message-ID maps to exactly one ticket (first writer
    // wins on conflict); the whole point is a stable id → ticket lookup.
    rfcMessageId: text("rfc_message_id").notNull().unique(),
    // 'inbound' (an email we received) | 'outbound' (a notification we sent).
    direction: text("direction").notNull().default("inbound"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("ticket_email_refs_ticket_id_idx").on(t.ticketId)],
);
