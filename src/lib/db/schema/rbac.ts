import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(false),
  // Who outranks whom: 0 staff, 1 Super Admin, 2 Technical Lead. You may
  // change a role only if your rank is STRICTLY higher than its rank. See
  // lib/auth/rank.ts. Not editable through the app — set by the installers.
  rank: integer("rank").notNull().default(0),
  createdById: uuid("created_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
}, (t) => [check("roles_rank_check", sql`${t.rank} BETWEEN 0 AND 2`)]);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    // Permission strings live as TypeScript constants in lib/auth/permissions.ts.
    // The DB stores the string; the closed set is enforced by code.
    permission: text("permission").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permission] }),
    index("role_permissions_permission_idx").on(t.permission),
  ],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    assignedById: uuid("assigned_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);
