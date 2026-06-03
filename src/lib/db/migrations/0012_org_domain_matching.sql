CREATE TABLE "organization_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_domains_format_check" CHECK ("organization_domains"."domain" ~ '^[a-z0-9.-]+.[a-z]{2,}$')
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "customer_company" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "org_match_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_domains" ADD CONSTRAINT "organization_domains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_domains_domain_key" ON "organization_domains" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "organization_domains_org_id_idx" ON "organization_domains" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_org_match_status_check" CHECK ("tickets"."org_match_status" IN ('account','domain','staff','unverified','none'));