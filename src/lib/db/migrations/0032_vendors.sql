-- Admin-managed vendor list for procurement requests. `procurement_requests.vendor`
-- stays plain free text (a picker suggestion, not a foreign key), so this table
-- only needs to exist and be seeded — no column changes on procurement_requests.
-- Apply idempotently via `pnpm db:add-vendors` (this repo applies post-0018
-- schema changes through one-shot idempotent scripts under src/lib/db/, not
-- the drizzle-kit migration journal — see the matching add-vendors.ts).

CREATE TABLE "vendors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_name_lower_key" ON "vendors" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "vendors_active_idx" ON "vendors" USING btree ("is_active");--> statement-breakpoint

INSERT INTO "vendors" ("name") VALUES
  ('Amazon'),
  ('Barracuda'),
  ('Battery UPS For Less'),
  ('BD Micro'),
  ('BitTitan'),
  ('Best Buy'),
  ('Canada Computers & Electronics'),
  ('CDW Canada'),
  ('Climb Channel Solutions'),
  ('D&H Canada'),
  ('Datto / Kaseya'),
  ('Dell'),
  ('Evolve'),
  ('Fibernetics Corp'),
  ('GoDaddy'),
  ('Hostine'),
  ('HP'),
  ('ISDecision'),
  ('KGPCo Canada'),
  ('Knowbe4'),
  ('Microsoft'),
  ('NewEgg Canada'),
  ('Sherweb'),
  ('ShoppersPlus'),
  ('SURGE ARREST CANADA INC.'),
  ('Ubiquity Inc'),
  ('UBNT.ca')
ON CONFLICT DO NOTHING;
