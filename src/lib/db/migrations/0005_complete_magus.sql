-- Add the new note column. `IF NOT EXISTS` so a partially-applied
-- migration can be re-run without manual recovery.
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "escalation_note" text;--> statement-breakpoint

-- Data migration: any pre-enum free-text escalation reasons get moved
-- into the new note column, and the categorical column is coerced to
-- 'other' so the CHECK constraint below succeeds. Idempotent — rows
-- already on the enum (or NULL) are untouched.
UPDATE "tickets"
   SET "escalation_note" = COALESCE("escalation_note", "escalation_reason"),
       "escalation_reason" = 'other'
 WHERE "escalation_reason" IS NOT NULL
   AND "escalation_reason" NOT IN ('beyond_scope','requires_access','critical_impact','vendor_involvement','other');--> statement-breakpoint

-- Drop any leftover constraint from a prior failed attempt, then create.
ALTER TABLE "tickets" DROP CONSTRAINT IF EXISTS "tickets_escalation_reason_check";--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_escalation_reason_check" CHECK ("tickets"."escalation_reason" IS NULL OR "tickets"."escalation_reason" IN ('beyond_scope','requires_access','critical_impact','vendor_involvement','other'));
