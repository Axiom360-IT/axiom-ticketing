import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// Personal access tokens for the Claude/MCP connector. A token acts AS the
// user it belongs to — every tool call re-runs the SAME can()/visibility
// checks that user's normal admin session would, so a token can never see or
// do more than that user already could. Self-service: a user creates/revokes
// their OWN tokens (see app/actions/mcp-tokens.ts) — no admin step needed,
// since it grants nothing beyond what the account already has.
//
// Only the SHA-256 hash of the token is stored (never the raw value) —
// same principle as a password hash. The raw token is shown to the user
// exactly once, at creation time, and cannot be retrieved again.
export const mcpTokens = pgTable(
  "mcp_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    // User-chosen label so they can tell tokens apart ("Boss's laptop").
    label: text("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("mcp_tokens_token_hash_key").on(t.tokenHash),
    index("mcp_tokens_user_id_idx").on(t.userId),
    foreignKey({
      columns: [t.userId],
      foreignColumns: [users.id],
      name: "mcp_tokens_user_id_fk",
    }).onDelete("cascade"),
  ],
);
