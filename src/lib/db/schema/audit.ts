import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Append-only + tamper-evident. Row UPDATE/DELETE are blocked by database
// triggers (`audit_log_prevent_mutation`, migration 0021); a deliberate
// full-table TRUNCATE (admin reset) is still allowed. Identity is snapshotted
// (actor_name/email) so a record stays attributable even if the referenced
// user is later removed — the actor/impersonator columns are therefore raw
// uuids with NO foreign key (an FK's ON DELETE SET NULL used to silently
// rewrite this "immutable" log).
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Strictly-increasing insertion order — deterministic sort + gap detection.
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    requestId: text("request_id"),
    sessionId: text("session_id"),
    actorId: uuid("actor_id"),
    // Snapshots at write time (survive user rename/deletion).
    actorName: text("actor_name"),
    actorEmail: text("actor_email"),
    // Snapshot of role names at the time of the action — survives role rename/delete.
    actorRoleSnapshot: text("actor_role_snapshot"),
    impersonatorId: uuid("impersonator_id"),
    impersonatorName: text("impersonator_name"),
    impersonatorEmail: text("impersonator_email"),
    action: text("action").notNull(),
    // Denormalized classifiers derived from `action` at write time.
    category: text("category"),
    severity: text("severity").notNull().default("info"),
    // 'success' | 'failure' | 'denied' | 'error'. Lets denials/failures live in
    // the same queryable stream as successful state changes.
    outcome: text("outcome").notNull().default("success"),
    failureReason: text("failure_reason"),
    targetType: text("target_type"),
    targetId: text("target_id"),
    // Human-readable label snapshot (ticket subject, org/user name) so the
    // target stays legible without a live join and after it's deleted.
    targetLabel: text("target_label"),
    beforeValue: jsonb("before_value"),
    afterValue: jsonb("after_value"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (t) => [
    uniqueIndex("audit_log_seq_idx").on(t.seq.desc()),
    index("audit_log_timestamp_idx").on(t.timestamp.desc()),
    index("audit_log_actor_id_timestamp_idx").on(
      t.actorId,
      t.timestamp.desc(),
    ),
    index("audit_log_action_idx").on(t.action),
    index("audit_log_category_idx").on(t.category),
    index("audit_log_target_idx").on(t.targetType, t.targetId),
    index("audit_log_request_id_idx").on(t.requestId),
    index("audit_log_session_id_idx").on(t.sessionId),
  ],
);
