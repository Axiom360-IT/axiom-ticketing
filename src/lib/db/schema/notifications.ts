import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    // Stored as i18n keys (e.g. 'notifications.ticket.assigned.title') so the
    // notification can be rendered in the user's locale at read time.
    titleKey: text("title_key").notNull(),
    titleArgs: jsonb("title_args"),
    bodyKey: text("body_key").notNull(),
    bodyArgs: jsonb("body_args"),
    linkUrl: text("link_url"),
    isRead: boolean("is_read").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("notifications_user_id_unread_idx").on(
      t.userId,
      t.isRead,
      t.createdAt.desc(),
    ),
    index("notifications_archive_idx")
      .on(t.createdAt)
      .where(sql`${t.archivedAt} IS NULL`),
  ],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    emailEnabled: boolean("email_enabled").notNull().default(true),
    smsEnabled: boolean("sms_enabled").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventType] })],
);
