-- Named, team-shared audit-log filter bookmarks. Stores the raw query
-- string rather than structured fields so it survives future filter
-- additions without a schema change.
--
-- Applied in production via `pnpm db:add-audit-filter-presets` (idempotent
-- script), not `drizzle-kit migrate` — mirrors the convention established by
-- migrations 0019-0028.
CREATE TABLE IF NOT EXISTS "audit_filter_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"query_string" text NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "audit_filter_presets" ADD CONSTRAINT "audit_filter_presets_created_by_id_fk"
		FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "audit_filter_presets_name_key" ON "audit_filter_presets" USING btree ("name");
