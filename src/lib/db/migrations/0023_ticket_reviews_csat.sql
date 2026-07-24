-- CSAT emoji feedback (three-point rating: happy | neutral | unhappy).
-- Adds the per-review history table + the latest-rating column on tickets.
-- Applied idempotently in production via `pnpm db:add-csat-reviews`.

ALTER TABLE "tickets" ADD COLUMN "csat_rating" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_csat_rating_check" CHECK ("tickets"."csat_rating" IS NULL OR "tickets"."csat_rating" IN ('happy','neutral','unhappy'));--> statement-breakpoint

-- Backfill the new 3-point rating from the existing binary response so pre-CSAT
-- tickets still count in the emoji breakdown. Legacy 'satisfied' maps to
-- 'happy' (we can't distinguish happy vs neutral retroactively); 'unsatisfied'
-- maps to 'unhappy'.
UPDATE "tickets" SET "csat_rating" = CASE
  WHEN "csat_response" = 'satisfied' THEN 'happy'
  WHEN "csat_response" = 'unsatisfied' THEN 'unhappy'
  ELSE "csat_rating"
END WHERE "csat_response" IS NOT NULL;--> statement-breakpoint

CREATE TABLE "ticket_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ticket_id" uuid NOT NULL,
  "rating" text NOT NULL,
  "comment" text,
  "technician_id" uuid,
  "technician_name" text,
  "respondent_email" text NOT NULL,
  "respondent_id" uuid,
  "submitted_via" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ticket_reviews_rating_check" CHECK ("ticket_reviews"."rating" IN ('happy','neutral','unhappy')),
  CONSTRAINT "ticket_reviews_submitted_via_check" CHECK ("ticket_reviews"."submitted_via" IN ('portal','email'))
);--> statement-breakpoint
ALTER TABLE "ticket_reviews" ADD CONSTRAINT "ticket_reviews_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_reviews" ADD CONSTRAINT "ticket_reviews_technician_id_users_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_reviews" ADD CONSTRAINT "ticket_reviews_respondent_id_users_id_fk" FOREIGN KEY ("respondent_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_reviews_ticket_id_idx" ON "ticket_reviews" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "ticket_reviews_technician_id_idx" ON "ticket_reviews" USING btree ("technician_id");--> statement-breakpoint
CREATE INDEX "ticket_reviews_created_at_idx" ON "ticket_reviews" USING btree ("created_at" DESC);--> statement-breakpoint
CREATE INDEX "ticket_reviews_rating_idx" ON "ticket_reviews" USING btree ("rating");
