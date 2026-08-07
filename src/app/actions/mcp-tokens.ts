"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { requireSessionUser } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/errors";
import {
  generateMcpToken,
  listMcpTokensForUser,
  revokeMcpToken,
  type McpTokenSummary,
} from "@/lib/auth/mcp-tokens";

// Self-service — a user manages their OWN Claude/MCP tokens, same as any
// personal-access-token page — gated on `mcp.connect` (seeded by default to
// Super Admin, IT Director, Coordinator only). A token still can never
// grant more than the account already has (every tool call re-runs the
// normal can() checks); this permission is purely "who's allowed to
// connect an assistant at all."

async function requireMcpConnect() {
  const caller = await requireSessionUser();
  if (!(await can(caller, "mcp.connect", { type: "global" }, productionContext))) {
    throw new ForbiddenError();
  }
  return caller;
}

export async function listMyMcpTokens(): Promise<McpTokenSummary[]> {
  const caller = await requireMcpConnect();
  return listMcpTokensForUser(caller.id);
}

const createSchema = z.object({
  label: z.string().trim().min(1).max(80),
});

export type CreateMcpTokenResult =
  | { ok: true; token: string }
  | { ok: false; error: string };

export async function createMyMcpToken(
  label: string,
): Promise<CreateMcpTokenResult> {
  const caller = await requireMcpConnect();
  const parsed = createSchema.safeParse({ label });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { token } = await generateMcpToken(caller.id, parsed.data.label);
  revalidatePath("/admin/profile");
  return { ok: true, token };
}

export async function revokeMyMcpToken(
  tokenId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await requireMcpConnect();
  const result = await revokeMcpToken(tokenId, caller.id);
  if (result.ok) revalidatePath("/admin/profile");
  return result;
}
