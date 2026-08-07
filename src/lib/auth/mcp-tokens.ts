import "server-only";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { mcpTokens } from "@/lib/db/schema/mcp-tokens";
import { loadSessionUserById } from "./session";
import { can, type SessionUser } from "./can";
import { productionContext } from "./can-context";

const TOKEN_PREFIX = "axmcp_";

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export type McpTokenSummary = {
  id: string;
  label: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

/** Self-service: creates a token for `userId` and returns the RAW value.
 *  This is the only moment the raw token ever exists outside the caller's
 *  clipboard — only its hash is stored, so it can't be shown again later. */
export async function generateMcpToken(
  userId: string,
  label: string,
): Promise<{ id: string; token: string }> {
  const id = randomUUID();
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
  await db.insert(mcpTokens).values({
    id,
    userId,
    label: label.trim() || "Untitled",
    tokenHash: hashToken(token),
  });
  return { id, token };
}

export async function listMcpTokensForUser(
  userId: string,
): Promise<McpTokenSummary[]> {
  return db
    .select({
      id: mcpTokens.id,
      label: mcpTokens.label,
      createdAt: mcpTokens.createdAt,
      lastUsedAt: mcpTokens.lastUsedAt,
      revokedAt: mcpTokens.revokedAt,
    })
    .from(mcpTokens)
    .where(eq(mcpTokens.userId, userId))
    .orderBy(mcpTokens.createdAt);
}

/** Revokes a token — scoped to the caller's OWN tokens only; there is no
 *  admin override, since a token only ever grants what its owner already
 *  has, so there's nothing an admin needs to police here. */
export async function revokeMcpToken(
  tokenId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [row] = await db
    .select({ id: mcpTokens.id })
    .from(mcpTokens)
    .where(and(eq(mcpTokens.id, tokenId), eq(mcpTokens.userId, userId)))
    .limit(1);
  if (!row) return { ok: false, error: "Token not found." };

  await db
    .update(mcpTokens)
    .set({ revokedAt: new Date() })
    .where(eq(mcpTokens.id, tokenId));
  return { ok: true };
}

/**
 * Validates a raw bearer token from an MCP request and, if it's live
 * (exists, not revoked, owner still holds `mcp.connect`), returns the SAME
 * SessionUser shape `can()` expects — built fresh from the DB every call,
 * so a role change or deactivation takes effect on the very next tool call,
 * not just the next login. The `mcp.connect` re-check here means a token
 * stops working the moment its owner is demoted out of an eligible role —
 * not just once someone remembers to revoke the token by hand.
 */
export async function resolveMcpToken(
  rawToken: string,
): Promise<SessionUser | null> {
  if (!rawToken.startsWith(TOKEN_PREFIX)) return null;
  const [row] = await db
    .select({ id: mcpTokens.id, userId: mcpTokens.userId })
    .from(mcpTokens)
    .where(
      and(eq(mcpTokens.tokenHash, hashToken(rawToken)), isNull(mcpTokens.revokedAt)),
    )
    .limit(1);
  if (!row) return null;

  const sessionUser = await loadSessionUserById(row.userId);
  if (!(await can(sessionUser, "mcp.connect", { type: "global" }, productionContext))) {
    return null;
  }

  // Best-effort — a failed timestamp update shouldn't block the request.
  db.update(mcpTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(mcpTokens.id, row.id))
    .catch(() => {});

  return sessionUser;
}
