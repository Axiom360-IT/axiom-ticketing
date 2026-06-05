import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { tickets } from "./tickets";

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "restrict" }),
    authorId: uuid("author_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    // Denormalized for guest replies (when author_id is null).
    authorEmail: text("author_email").notNull(),
    authorName: text("author_name").notNull(),
    authorType: text("author_type").notNull(),
    body: text("body").notNull(),
    // 'text' for legacy/email/system messages; 'html' for rich-text replies
    // composed via the dashboard or portal. Renderers branch on this so we
    // never blindly trust a stored string as HTML. New rows default to
    // 'text' — composers explicitly opt into 'html' when they sanitize.
    bodyFormat: text("body_format").notNull().default("text"),
    channel: text("channel").notNull(),
    isInternalNote: boolean("is_internal_note").notNull().default(false),
    isResolutionNote: boolean("is_resolution_note").notNull().default(false),
    isAnonymized: boolean("is_anonymized").notNull().default(false),
    // Inbound moderation (req 5.2). Almost everything is 'approved' on insert.
    // An email reply whose sender's domain does NOT belong to the ticket's
    // organization is stored 'held' and EXCLUDED from every conversation render
    // until a coordinator approves it (or 'rejected' if they decline). The
    // `reviewed*` columns record who moderated it.
    moderationStatus: text("moderation_status").notNull().default("approved"),
    heldReason: text("held_reason"),
    reviewedById: uuid("reviewed_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("messages_ticket_id_created_at_idx").on(t.ticketId, t.createdAt),
    check(
      "messages_author_type_check",
      sql`${t.authorType} IN ('agent','customer','system')`,
    ),
    check(
      "messages_channel_check",
      sql`${t.channel} IN ('email','portal','dashboard','system')`,
    ),
    check(
      "messages_body_format_check",
      sql`${t.bodyFormat} IN ('text','html')`,
    ),
    check(
      "messages_moderation_status_check",
      sql`${t.moderationStatus} IN ('approved','held','rejected')`,
    ),
  ],
);
