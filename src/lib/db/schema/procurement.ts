import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { tickets } from "./tickets";

// ── Procurement (Meeting-2, CR-20..CR-26) ─────────────────────────────
//
// The approval workflow was removed: if a technician says an item is needed,
// it is needed. The coordinator ACTIONS the request through four single-select
// stages instead of approving it. Urgency was dropped to minimise inputs.
// ──────────────────────────────────────────────────────────────────────

export const procurementRequests = pgTable(
  "procurement_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "restrict" }),
    requestedById: uuid("requested_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    requestedByEmail: text("requested_by_email").notNull(),
    // hardware | software | other (CR-20)
    type: text("type").notNull(),
    itemName: text("item_name").notNull(),
    quantity: integer("quantity").notNull().default(1),
    // Optional (CR-23) — technician may not know the cost/vendor.
    estimatedCost: numeric("estimated_cost", { precision: 12, scale: 2 }),
    vendor: text("vendor"),
    justification: text("justification").notNull(),
    // Required at the form level (CR-22); nullable in DB for legacy rows.
    dateNeededBy: date("date_needed_by"),
    // Four single-select stages (CR-26):
    // awaiting_customer_payment | order_pending | order_placed | order_completed
    // Who moved the stage + when is captured in the audit log
    // (procurement.set_status), so no decision columns live on the row.
    status: text("status").notNull().default("awaiting_customer_payment"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("procurement_ticket_id_idx").on(t.ticketId),
    index("procurement_status_idx").on(t.status),
    index("procurement_requested_by_id_idx").on(t.requestedById),
    check("procurement_quantity_check", sql`${t.quantity} > 0`),
    check(
      "procurement_status_check",
      sql`${t.status} IN ('awaiting_customer_payment','order_pending','order_placed','order_completed')`,
    ),
    check(
      "procurement_type_check",
      sql`${t.type} IN ('hardware','software','other')`,
    ),
  ],
);
