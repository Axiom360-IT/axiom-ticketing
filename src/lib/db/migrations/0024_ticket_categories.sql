-- Admin-managed ticket categories. Moves the category list out of a hard-coded
-- CHECK into a table, seeds the original five (so existing tickets are
-- unaffected), and drops the CHECK. Apply idempotently via
-- `pnpm db:add-ticket-categories`.

CREATE TABLE "ticket_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "value" text NOT NULL,
  "label" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "ticket_categories" ADD CONSTRAINT "ticket_categories_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_categories_value_key" ON "ticket_categories" USING btree ("value");--> statement-breakpoint
CREATE INDEX "ticket_categories_sort_idx" ON "ticket_categories" USING btree ("sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_categories_one_default_idx" ON "ticket_categories" USING btree ("is_default") WHERE "ticket_categories"."is_default" = true;--> statement-breakpoint

-- Seed the original five so every existing ticket keeps a valid, labelled
-- category. 'other' is the protected default (guest/inbound fallback).
INSERT INTO "ticket_categories" ("value","label","sort_order","is_active","is_default") VALUES
  ('hardware','Hardware',1,true,false),
  ('software','Software',2,true,false),
  ('network','Network',3,true,false),
  ('access','Access',4,true,false),
  ('other','Other',5,true,true)
ON CONFLICT ("value") DO NOTHING;--> statement-breakpoint

-- Category is now validated in the app layer against this table.
ALTER TABLE "tickets" DROP CONSTRAINT IF EXISTS "tickets_category_check";
