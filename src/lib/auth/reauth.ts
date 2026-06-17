import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { Redis } from "@upstash/redis";

// Sensitive-operation re-auth (M17 Phase B). Some Server Actions require
// the user to have re-typed their password within the last few minutes
// even though they're signed in — granting Super Admin role, changing
// app-wide settings, etc. `verifyReauth` marks the session fresh; the
// sensitive actions check it.
//
// Freshness is recorded in TWO places:
//   1. A signed, httpOnly cookie (primary). Set on the SAME response as the
//      password verify, so the immediate retry of the sensitive action sees
//      it with NO cross-region Redis read-after-write lag. This is the fix
//      for "I just re-authed but it asks me again" on a distributed Upstash
//      database, where the write and the retry's read can hit different
//      replicas (separate serverless invocations).
//   2. Redis (best-effort secondary). Covers the same user on other
//      devices/sessions and survives a cookie being cleared.
//
// Without Upstash configured (dev), the gate fails OPEN — same posture
// as the rate-limit and lockout helpers, with the production-only
// warning at module load in `lib/ratelimit.ts` covering the misconfig.

const HAS_UPSTASH = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);
const redis = HAS_UPSTASH ? Redis.fromEnv() : null;

export const REAUTH_WINDOW_MS = 5 * 60 * 1000;
const REAUTH_PREFIX = "axiom:reauth:";
const REAUTH_COOKIE_NAME = "axiom_reauth";

function key(userId: string) {
  return `${REAUTH_PREFIX}${userId}`;
}

// ── Signed freshness cookie ──────────────────────────────────────────
// Wire format mirrors lib/tokens.ts: base64url(`<userId>|<expiresAtMs>:<sig>`),
// HMAC-SHA256 over the payload with the app's auth secret. Tamper-proof, so a
// user can't forge "I re-authed"; bound to the userId so it can't be reused
// across accounts in a shared browser.
function reauthSecret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("BETTER_AUTH_SECRET is not set");
  return s;
}

function signPayload(payload: string): string {
  return createHmac("sha256", reauthSecret()).update(payload).digest("hex");
}

function signReauthCookie(userId: string, expiresAt: number): string {
  const payload = `${userId}|${expiresAt}`;
  return Buffer.from(`${payload}:${signPayload(payload)}`).toString("base64url");
}

function isReauthCookieValid(userId: string, value: string): boolean {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const lastColon = decoded.lastIndexOf(":");
    if (lastColon < 0) return false;
    const payload = decoded.slice(0, lastColon);
    const providedSig = decoded.slice(lastColon + 1);
    const [uid, expStr] = payload.split("|");
    if (uid !== userId) return false;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || Date.now() >= exp) return false;
    const expectedSig = signPayload(payload);
    if (providedSig.length !== expectedSig.length) return false;
    return timingSafeEqual(Buffer.from(providedSig), Buffer.from(expectedSig));
  } catch {
    return false;
  }
}

/** Mark `userId` as freshly re-authenticated for the next REAUTH_WINDOW_MS. */
export async function markReauthFresh(userId: string): Promise<void> {
  const expiresAt = Date.now() + REAUTH_WINDOW_MS;
  // Cookie (primary) — instant, instance-independent.
  try {
    const cookieStore = await cookies();
    cookieStore.set(REAUTH_COOKIE_NAME, signReauthCookie(userId, expiresAt), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(REAUTH_WINDOW_MS / 1000),
    });
  } catch {
    // cookies() unavailable (non-request context) or no secret — the Redis
    // marker below still records freshness.
  }
  // Redis (best-effort secondary) — never let a Redis hiccup fail the verify.
  if (redis) {
    try {
      await redis.set(key(userId), Date.now(), { px: REAUTH_WINDOW_MS });
    } catch {
      // ignore — the cookie is the authoritative signal for this device
    }
  }
}

/**
 * Returns true if `userId` re-typed their password recently enough. Checks the
 * signed cookie first (no replication race), then falls back to Redis. Always
 * returns true when Redis isn't configured (fail-open, dev).
 */
export async function isReauthFresh(userId: string): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const cookie = cookieStore.get(REAUTH_COOKIE_NAME)?.value;
    if (cookie && isReauthCookieValid(userId, cookie)) return true;
  } catch {
    // cookies() unavailable — fall through to Redis.
  }
  if (!redis) return true;
  try {
    const value = await redis.get<number>(key(userId));
    return value != null && Date.now() - value < REAUTH_WINDOW_MS;
  } catch {
    // Redis unreachable and no valid cookie — treat as not fresh.
    return false;
  }
}

/** Stable sentinel result Server Actions return when re-auth is needed. */
export type ReauthRequiredResult = {
  ok: false;
  error: string;
  reauthRequired: true;
};

export const REAUTH_REQUIRED_MESSAGE = "Re-authentication required";

export function reauthRequiredResult(): ReauthRequiredResult {
  return {
    ok: false,
    error: REAUTH_REQUIRED_MESSAGE,
    reauthRequired: true,
  };
}
