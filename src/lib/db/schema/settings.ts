import { sql } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedById: uuid("updated_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
});
