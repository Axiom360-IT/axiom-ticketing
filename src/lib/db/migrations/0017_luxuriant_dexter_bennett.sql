CREATE TABLE "organization_trusted_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"added_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_trusted_emails" ADD CONSTRAINT "organization_trusted_emails_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_trusted_emails" ADD CONSTRAINT "organization_trusted_emails_added_by_id_users_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_trusted_emails_org_email_key" ON "organization_trusted_emails" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "org_trusted_emails_org_id_idx" ON "organization_trusted_emails" USING btree ("organization_id");--> statement-breakpoint
-- Seed the inbound-moderation toggle on already-seeded databases (db:seed is a
-- no-op once roles exist). Default true = hold unrecognized senders.
INSERT INTO "settings" ("key", "value", "description")
VALUES ('inbound_moderation_enabled', 'true'::jsonb, 'Hold inbound replies from unrecognized senders for moderation (false = post directly)')
ON CONFLICT ("key") DO NOTHING;