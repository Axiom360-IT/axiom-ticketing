import { sql } from "drizzle-orm";
import { index, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { tickets } from "./tickets";

// ── Multi-technician assignment (Meeting-2, CR-11) ────────────────────
//
// `tickets.assigned_to_id` remains the PRIMARY assignee (it drives the
// "my tickets" queue, SLA ownership, and the primary notification). This
// junction adds COLLABORATING technicians so an admin/coordinator can put
// several technicians on one ticket. Strict-technician visibility is the
// union of the primary assignee and any collaborator rows here.
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
