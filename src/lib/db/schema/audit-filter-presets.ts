import { sql } from "drizzle-orm";
import {
  foreignKey,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// Named, TEAM-SHARED audit-log filter bookmarks (e.g. "Security review" =
// category=security&outcome=denied). Stores the raw query string rather than
// structured filter fields — reproduces exactly what was on screen when
// saved, and needs no changes when a new filter param (search, date range,
// etc.) is added later.
export const auditFilterPresets = pgTable(
  "audit_filter_presets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    queryString: text("query_string").notNull(),
    createdById: uuid("created_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    uniqueIndex("audit_filter_presets_name_key").on(t.name),
    foreignKey({
      columns: [t.createdById],
      foreignColumns: [users.id],
      name: "audit_filter_presets_created_by_id_fk",
    }).onDelete("set null"),
  ],
);
