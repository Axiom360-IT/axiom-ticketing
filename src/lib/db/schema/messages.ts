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
    channel: text("channel").notNull(),
    isInternalNote: boolean("is_internal_note").notNull().default(false),
    isResolutionNote: boolean("is_resolution_note").notNull().default(false),
    isAnonymized: boolean("is_anonymized").notNull().default(false),
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
  ],
);
