-- Personal access tokens for the Claude/MCP connector. Only the token HASH
-- is stored; the raw token is shown once at creation and never again.
--
-- Applied in production via `pnpm db:add-mcp-tokens` (idempotent script),
-- not `drizzle-kit migrate` — mirrors the convention established by
-- migrations 0019-0029.
CREATE TABLE IF NOT EXISTS "mcp_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_user_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_tokens_token_hash_key" ON "mcp_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_tokens_user_id_idx" ON "mcp_tokens" USING btree ("user_id");
