import { sql } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

// ── Vendors (admin-managed) ────────────────────────────────────────────
//
// A curated, searchable vendor list for procurement requests. Unlike ticket
// categories/types, `procurement_requests.vendor` stores plain free text, not
// a slug reference to this table — the picker offers these names as
// suggestions (and lets a requester type a one-off vendor that never joins
// the managed list), and renaming/deactivating a vendor here never rewrites
// past requests. That keeps historical requests showing exactly what was
// selected at the time, same as `messages.author_name` snapshots.
// ──────────────────────────────────────────────────────────────────────

export const vendors = pgTable(
  "vendors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // Deactivated vendors drop out of the picker but stay in past requests'
    // free-text snapshots.
    isActive: boolean("is_active").notNull().default(true),
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
    uniqueIndex("vendors_name_lower_key").on(sql`lower(${t.name})`),
    index("vendors_active_idx").on(t.isActive),
  ],
);
