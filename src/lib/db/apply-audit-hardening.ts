import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: apply the audit-log hardening (mirrors migration 0021)
 * through the app's OWN DB connection, for when the Neon console SQL editor is
 * blocked (free-tier compute limit). Every statement is guarded so re-runs are
 * a no-op.
 *
 * Run via `pnpm db:harden-audit`.
 */
const STATEMENTS = [
  // 1. Identity snapshots + outcome + classification.
  sql`ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "actor_name" text`,
  sql`ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "actor_email" text`,
  sql`ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "impersonator_name" text`,
  sql`ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "impersonator_email" text`,
  sql`ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "outcome" text DEFAULT 'success' NOT NULL`,
  sql`ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "failure_reason" text`,
  sql`ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "category" text`,
  sql`ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "severity" text DEFAULT 'info' NOT NULL`,
  sql`ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "target_label" text`,
  sql`ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "session_id" text`,
  // 2. Gapless ordering.
  sql`ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "seq" bigint GENERATED ALWAYS AS IDENTITY`,
  sql`CREATE UNIQUE INDEX IF NOT EXISTS "audit_log_seq_idx" ON "audit_log" USING btree ("seq" DESC)`,
  sql`CREATE INDEX IF NOT EXISTS "audit_log_category_idx" ON "audit_log" USING btree ("category")`,
  sql`CREATE INDEX IF NOT EXISTS "audit_log_session_id_idx" ON "audit_log" USING btree ("session_id")`,
  // 3. Drop the set-null FKs that rewrote history on user deletion.
  sql`ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_actor_id_users_id_fk"`,
  sql`ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_impersonator_id_users_id_fk"`,
  // 4. Append-only enforcement (row UPDATE/DELETE blocked; TRUNCATE still ok).
  sql`CREATE OR REPLACE FUNCTION audit_log_prevent_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql`,
  sql`DROP TRIGGER IF EXISTS audit_log_no_update ON "audit_log"`,
  sql`CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_mutation()`,
  sql`DROP TRIGGER IF EXISTS audit_log_no_delete ON "audit_log"`,
  sql`CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_mutation()`,
];

async function main(): Promise<void> {
  for (const stmt of STATEMENTS) {
    await db.execute(stmt);
  }
  console.log("✓ audit_log hardening applied (snapshots, seq, append-only triggers).");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
