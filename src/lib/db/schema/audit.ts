import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// Append-only. Database role grants restrict UPDATE and DELETE on this table
// (applied as a custom step in the initial migration).
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    requestId: text("request_id"),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Snapshot of role names at the time of the action — survives role rename/delete.
    actorRoleSnapshot: text("actor_role_snapshot"),
    impersonatorId: uuid("impersonator_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    beforeValue: jsonb("before_value"),
    afterValue: jsonb("after_value"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (t) => [
    index("audit_log_timestamp_idx").on(t.timestamp.desc()),
    index("audit_log_actor_id_timestamp_idx").on(
      t.actorId,
      t.timestamp.desc(),
    ),
    index("audit_log_action_idx").on(t.action),
    index("audit_log_target_idx").on(t.targetType, t.targetId),
    index("audit_log_request_id_idx").on(t.requestId),
  ],
);
