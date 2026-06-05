import { sql } from "drizzle-orm";
import { index, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { tickets } from "./tickets";

// ── Merge co-assignee (the single-technician exception) ───────────────
//
// Every ticket has exactly ONE primary technician: `tickets.assigned_to_id`
// (it drives the "my tickets" queue, SLA ownership, and the primary
// notification). A ticket may carry a SECOND technician ONLY as the result of
// a merge: when two tickets are merged, the source ticket's technician is
// recorded here as a co-assignee on the surviving (target) ticket — the one
// sanctioned exception to the single-technician rule (req 3.1 / 4.4). Rows are
// written solely by the merge flow; a Superadmin can remove either technician
// (removing the primary promotes the co-assignee — req 4.5). Strict-technician
// visibility is the union of the primary assignee and any co-assignee row here.
// ──────────────────────────────────────────────────────────────────────

export const ticketAssignees = pgTable(
  "ticket_assignees",
  {
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    assignedById: uuid("assigned_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.ticketId, t.userId] }),
    index("ticket_assignees_user_id_idx").on(t.userId),
  ],
);
