import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// ── Ticket types (admin-managed) ──────────────────────────────────────
//
// The "type of work" dimension (Service Request / Incident / Change / Project /
// Alert), separate from `category` (the "area" — hardware/software/…). Like
// categories it's an admin-managed table so the list can be edited from the UI
// without a code change. Tickets store the type `value` (a stable slug); the
// label is resolved from this table at render time.
//
// Seeded with the five standard ITSM types, with 'service_request' as the
// protected default that new/guest/inbound tickets fall back to. Types in use
// are deactivated rather than deleted so historical tickets keep their label.
// ──────────────────────────────────────────────────────────────────────

export const ticketTypes = pgTable(
  "ticket_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    value: text("value").notNull(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    createdById: uuid("created_by_id").references(() => users.id, {
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
    uniqueIndex("ticket_types_value_key").on(t.value),
    index("ticket_types_sort_idx").on(t.sortOrder),
    uniqueIndex("ticket_types_one_default_idx")
      .on(t.isDefault)
      .where(sql`${t.isDefault} = true`),
  ],
);
