-- Audit-log hardening (Meeting-3 review): self-contained identity, outcome,
-- classification, gapless ordering, and real append-only enforcement.

-- 1. Identity snapshots (survive user deletion) + outcome + classification.
--    All nullable or defaulted, so every existing writer call stays valid.
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "actor_name" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "actor_email" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "impersonator_name" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "impersonator_email" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "outcome" text DEFAULT 'success' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "failure_reason" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "category" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "severity" text DEFAULT 'info' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "target_label" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "session_id" text;--> statement-breakpoint

-- 2. Gapless, strictly-increasing sequence for deterministic ordering
--    (replaces the random-UUID tie-break). Fills existing rows on add.
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "seq" bigint GENERATED ALWAYS AS IDENTITY;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "audit_log_seq_idx" ON "audit_log" USING btree ("seq" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_category_idx" ON "audit_log" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_session_id_idx" ON "audit_log" USING btree ("session_id");--> statement-breakpoint

-- 3. Stop user deletion from mutating history. Identity now lives in the
--    snapshot columns, so the set-null FKs are no longer needed (and were the
--    one code path that silently rewrote the "append-only" log).
ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_actor_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_impersonator_id_users_id_fk";--> statement-breakpoint

-- 4. Enforce append-only at the database. Individual rows can never be UPDATEd
--    or DELETEd (owner-proof — the app connects as the table owner, so a REVOKE
--    alone would not bind). A deliberate full-table TRUNCATE (the admin
--    reset-for-production path) still works: row triggers do not fire on
--    TRUNCATE.
CREATE OR REPLACE FUNCTION audit_log_prevent_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_no_update ON "audit_log";--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_mutation();--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_no_delete ON "audit_log";--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_mutation();
