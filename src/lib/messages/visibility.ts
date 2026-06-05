import { and, eq, type SQL } from "drizzle-orm";
import { messages } from "@/lib/db/schema/messages";

/**
 * Inbound replies held for moderation (or rejected) must NEVER appear in any
 * conversation thread — admin OR customer — until a coordinator approves them
 * (req 5.2). Every message-thread query must AND this in. Held/rejected content
 * lives only in the moderation queue.
 */
export function approvedMessages(): SQL {
  return eq(messages.moderationStatus, "approved");
}

// Customer-facing surfaces (the public ticket-tracking page in M5, future
// guest portal API responses) MUST use this predicate when querying the
// `messages` table. Internal notes are agent-only — they live in the same
// table for thread continuity but never leave the dashboard. Also excludes
// unmoderated (held/rejected) inbound messages.
//
// Admin views deliberately do NOT exclude internal notes — agents see those
// inline (with a yellow lock badge) — but they DO exclude held messages, so
// they use approvedMessages() directly.
export function customerVisibleMessages(): SQL {
  return and(eq(messages.isInternalNote, false), approvedMessages())!;
}
