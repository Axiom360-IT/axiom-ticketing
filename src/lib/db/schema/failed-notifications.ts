import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// After Inngest retries are exhausted, the failure lands here for manual
// review or scripted retry. `resolved_at` IS NULL = the active queue.
export const failedNotifications = pgTable(
  "failed_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inngestEventId: text("inngest_event_id").notNull(),
    channel: text("channel").notNull(),
    eventType: text("event_type").notNull(),
    recipient: text("recipient").notNull(),
    payload: jsonb("payload"),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").notNull(),
    firstAttemptAt: timestamp("first_attempt_at", {
      withTimezone: true,
    }).notNull(),
    lastAttemptAt: timestamp("last_attempt_at", {
      withTimezone: true,
    }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("failed_notifications_active_idx")
      .on(t.lastAttemptAt)
      .where(sql`${t.resolvedAt} IS NULL`),
    index("failed_notifications_last_attempt_idx").on(t.lastAttemptAt),
  ],
);
