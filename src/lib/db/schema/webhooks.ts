import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// Webhook idempotency: every inbound webhook event is recorded by
// (provider, event_id) before processing. Duplicates short-circuit.
// Cleanup cron deletes rows older than 30 days.
export const processedWebhookEvents = pgTable(
  "processed_webhook_events",
  {
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.eventId] }),
    index("processed_webhook_events_received_at_idx").on(t.receivedAt),
  ],
);
