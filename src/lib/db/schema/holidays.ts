import { sql } from "drizzle-orm";
import { date, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

// Admin-editable list of holidays. SLA computation skips these days when the
// affected priority has `respect_business_hours = true`.
export const holidays = pgTable("holidays", {
  date: date("date").primaryKey(),
  label: text("label").notNull(),
  createdById: uuid("created_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});
