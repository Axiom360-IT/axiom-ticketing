import { eq, type SQL } from "drizzle-orm";
import { messages } from "@/lib/db/schema/messages";

// Customer-facing surfaces (the public ticket-tracking page in M5, future
// guest portal API responses) MUST use this predicate when querying the
// `messages` table. Internal notes are agent-only — they live in the same
// table for thread continuity but never leave the dashboard.
//
// Admin views deliberately do NOT use this — agents see internal notes
// inline with normal replies (with a yellow lock badge in the thread).
export function customerVisibleMessages(): SQL {
  return eq(messages.isInternalNote, false);
}
