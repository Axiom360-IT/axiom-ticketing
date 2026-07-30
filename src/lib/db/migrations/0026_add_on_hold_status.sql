-- Add the "On hold" ticket status + the SLA-pause column.
-- The status CHECK is a closed set, so it must be dropped and re-added with the
-- new value. `sla_paused_at` records when a ticket's SLA clock is frozen
-- (awaiting customer / on hold). Apply idempotently via `pnpm db:add-on-hold-status`.

ALTER TABLE "tickets" DROP CONSTRAINT IF EXISTS "tickets_status_check";--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_status_check" CHECK ("tickets"."status" IN ('draft','open','in_progress','awaiting_customer_confirmation','on_hold','escalation','resolved','closed'));--> statement-breakpoint

ALTER TABLE "tickets" ADD COLUMN "sla_paused_at" timestamp with time zone;
