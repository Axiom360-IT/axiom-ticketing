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

// ── Ticket categories (admin-managed) ─────────────────────────────────
//
// The list of ticket categories used to be a hard-coded set enforced by a
// CHECK constraint on `tickets.category`. It's now an admin-managed table so
// coordinators can add / rename / reorder / retire categories from the UI
// without a code change. Tickets store the category `value` (a stable slug);
// the human label is resolved from this table at render time, so renaming a
// category's label updates it everywhere without touching ticket rows.
//
// The original five (hardware/software/network/access/other) are seeded with
// their existing values so every pre-existing ticket keeps displaying
// correctly. Categories in use are deactivated ("isActive=false") rather than
// deleted, so historical tickets never lose their label.
// ──────────────────────────────────────────────────────────────────────

export const ticketCategories = pgTable(
  "ticket_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Stable slug stored on `tickets.category`. Immutable after creation
    // (admins edit the label, not the value) so ticket rows never need
    // rewriting.
    value: text("value").notNull(),
    // Human-readable display name (editable).
    label: text("label").notNull(),
    // Ordering in dropdowns / filters (ascending).
    sortOrder: integer("sort_order").notNull().default(0),
    // Deactivated categories stay resolvable for old tickets but disappear
    // from the pickers.
    isActive: boolean("is_active").notNull().default(true),
    // Exactly one row may be the default (the category new/guest/inbound
    // tickets fall back to). Enforced by the partial unique index below; the
    // default can't be deleted or deactivated (guarded in the actions).
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
    uniqueIndex("ticket_categories_value_key").on(t.value),
    index("ticket_categories_sort_idx").on(t.sortOrder),
    // At most one default category.
    uniqueIndex("ticket_categories_one_default_idx")
      .on(t.isDefault)
      .where(sql`${t.isDefault} = true`),
  ],
);
