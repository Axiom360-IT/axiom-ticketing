ALTER TABLE "tickets" DROP CONSTRAINT IF EXISTS "tickets_status_check";--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_status_check" CHECK ("tickets"."status" IN ('draft','open','in_progress','resolved','closed'));
