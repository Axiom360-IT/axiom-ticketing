import "server-only";
import { and, inArray, isNull } from "drizzle-orm";
import { db, type Database, type Tx } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema/auth";
import { mcpTokens } from "@/lib/db/schema/mcp-tokens";

/**
 * Cuts off every live credential the given users hold: browser sessions are
 * deleted outright, MCP bearer tokens are stamped revoked.
 *
 * Session resolution already refuses a deactivated user on every request
 * (see `getSessionUser` / `loadSessionUserById`), so this is the second
 * layer rather than the only one — but it matters on its own terms too: it
 * makes the rows on disk match reality, so nobody reading a token list has
 * to know about the deactivation to understand what is live.
 *
 * Reactivation deliberately does NOT restore these. A revoked token stays
 * revoked and the owner generates a fresh one, exactly as with any manual
 * revoke; sessions are re-established by signing in again.
 *
 * Pass a `Tx` to run inside a caller's transaction.
 */
export async function revokeAllUserAccess(
  userIds: string[],
  exec: Database | Tx = db,
): Promise<void> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return;

  await exec.delete(sessions).where(inArray(sessions.userId, ids));
  await exec
    .update(mcpTokens)
    .set({ revokedAt: new Date() })
    .where(and(inArray(mcpTokens.userId, ids), isNull(mcpTokens.revokedAt)));
}
