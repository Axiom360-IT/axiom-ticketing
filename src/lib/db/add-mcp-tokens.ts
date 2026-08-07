import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: create the `mcp_tokens` table (mirrors migration
 * 0030) — personal access tokens for the Claude/MCP connector.
 *
 * Run via `pnpm db:add-mcp-tokens`.
 */
async function main(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "mcp_tokens" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL,
      "token_hash" text NOT NULL,
      "label" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "last_used_at" timestamp with time zone,
      "revoked_at" timestamp with time zone
    )
  `);
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_user_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "mcp_tokens_token_hash_key" ON "mcp_tokens" USING btree ("token_hash")`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "mcp_tokens_user_id_idx" ON "mcp_tokens" USING btree ("user_id")`,
  );
  console.log("✓ mcp_tokens table is present.");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
