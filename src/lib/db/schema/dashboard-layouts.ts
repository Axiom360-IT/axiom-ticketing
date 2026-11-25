import { sql } from "drizzle-orm";
import { jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

// One row per person: how they arranged their admin dashboard (which widgets,
// where, how big, which chart type). Personal, not shared. The shape lives in
// `lib/dashboard/layout.ts`; it is re-validated on every read and write, so the
// column is deliberately free-form jsonb and a future version can change it
// without a migration.
//
// Deleting the user deletes their layout. No row = the default layout.
export const dashboardLayouts = pgTable("dashboard_layouts", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  layout: jsonb("layout").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});
