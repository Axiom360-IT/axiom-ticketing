"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { markReauthFresh, REAUTH_WINDOW_MS } from "@/lib/auth/reauth";
import { requireSessionUser } from "@/lib/auth/session";

// Verifies the current user's password and, on success, marks them as
// "freshly re-authenticated" in Redis for the next REAUTH_WINDOW_MS.
// Sensitive Server Actions check the freshness flag via
// `requireRecentReauth(userId)` before running.

export type VerifyReauthResult =
  | { ok: true; freshForMs: number }
  | { ok: false; error: string };

export async function verifyReauth(
  password: string,
): Promise<VerifyReauthResult> {
  const user = await requireSessionUser();
  if (typeof password !== "string" || password.length === 0) {
    return { ok: false, error: "Password is required" };
  }

  let ok = false;
  try {
    const result = await auth.api.verifyPassword({
      body: { password },
      headers: await headers(),
    });
    ok = (result as unknown as { status?: boolean })?.status === true;
  } catch {
    ok = false;
  }
  if (!ok) {
    return { ok: false, error: "Incorrect password" };
  }

  await markReauthFresh(user.id);
  return { ok: true, freshForMs: REAUTH_WINDOW_MS };
}
