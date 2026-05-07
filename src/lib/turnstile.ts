// Cloudflare Turnstile server-side verification.
// In dev without TURNSTILE_SECRET, verification is skipped (returns true)
// with a console warning. In production it is required.

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult =
  | { success: true }
  | { success: false; reason: string };

export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp?: string,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return { success: false, reason: "turnstile_not_configured" };
    }
    // Dev: skip verification, warn loudly
    console.warn(
      "[turnstile] TURNSTILE_SECRET not set — skipping verification (dev only).",
    );
    return { success: true };
  }

  if (!token) {
    return { success: false, reason: "missing_token" };
  }

  const params = new URLSearchParams({ secret, response: token });
  if (remoteIp) params.set("remoteip", remoteIp);

  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body: params,
    });
    const data = (await res.json()) as { success: boolean; "error-codes"?: string[] };

    if (data.success) return { success: true };
    return {
      success: false,
      reason: data["error-codes"]?.join(",") ?? "verification_failed",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, reason: `network_error:${msg}` };
  }
}
