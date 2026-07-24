-- Admin-managed ticket TYPES (the ITSM "type of work" dimension), separate from
-- category. Adds the table (seeded with the five standard types) and a
-- `tickets.type` column defaulting to 'service_request' so every existing
-- ticket gets a valid type. Apply idempotently via `pnpm db:add-ticket-types`.

CREATE TABLE "ticket_types" (
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
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_types_value_key" ON "ticket_types" USING btree ("value");--> statement-breakpoint
CREATE INDEX "ticket_types_sort_idx" ON "ticket_types" USING btree ("sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_types_one_default_idx" ON "ticket_types" USING btree ("is_default") WHERE "ticket_types"."is_default" = true;--> statement-breakpoint

INSERT INTO "ticket_types" ("value","label","sort_order","is_active","is_default") VALUES
  ('service_request','Service Request',1,true,true),
  ('incident','Incident',2,true,false),
  ('change','Change',3,true,false),
  ('project','Project',4,true,false),
  ('alert','Alert',5,true,false)
ON CONFLICT ("value") DO NOTHING;--> statement-breakpoint

-- New column; DEFAULT backfills every existing ticket with 'service_request'.
ALTER TABLE "tickets" ADD COLUMN "type" text DEFAULT 'service_request' NOT NULL;
