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
    type: text("type").notNull(),
    itemName: text("item_name").notNull(),
    quantity: integer("quantity").notNull().default(1),
    estimatedCost: numeric("estimated_cost", { precision: 12, scale: 2 }),
    vendor: text("vendor"),
    justification: text("justification").notNull(),
    urgency: text("urgency").notNull(),
    dateNeededBy: date("date_needed_by"),
    status: text("status")
      .notNull()
      .default("pending_coordinator_approval"),
    coordinatorDecisionById: uuid("coordinator_decision_by_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    coordinatorDecisionAt: timestamp("coordinator_decision_at", {
      withTimezone: true,
    }),
    adminDecisionById: uuid("admin_decision_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    adminDecisionAt: timestamp("admin_decision_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    rejectedAtStep: text("rejected_at_step"),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }),
    purchasedById: uuid("purchased_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    deliveredById: uuid("delivered_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
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
      sql`${t.status} IN ('pending_coordinator_approval','pending_admin_approval','approved','rejected','purchased','delivered')`,
    ),
    check(
      "procurement_type_check",
      sql`${t.type} IN ('hardware','software')`,
    ),
    check(
      "procurement_urgency_check",
      sql`${t.urgency} IN ('low','medium','high')`,
    ),
    check(
      "procurement_rejected_at_step_check",
      sql`${t.rejectedAtStep} IS NULL OR ${t.rejectedAtStep} IN ('coordinator','admin')`,
    ),
  ],
);
