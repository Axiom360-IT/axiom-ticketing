import { Redis } from "@upstash/redis";

// Sensitive-operation re-auth (M17 Phase B). Some Server Actions require
// the user to have re-typed their password within the last few minutes
// even though they're signed in — granting Super Admin role, changing
// app-wide settings, etc. We track a "last verified" timestamp per user
// in Redis with a TTL equal to the freshness window. `verifyReauth`
// writes it; `requireRecentReauth` checks it.
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

function key(userId: string) {
  return `${REAUTH_PREFIX}${userId}`;
}

/** Mark `userId` as freshly re-authenticated for the next REAUTH_WINDOW_MS. */
export async function markReauthFresh(userId: string): Promise<void> {
  if (!redis) return;
  await redis.set(key(userId), Date.now(), { px: REAUTH_WINDOW_MS });
}

/**
 * Returns true if `userId` re-typed their password recently enough.
 * Always returns true when Redis isn't configured (fail-open).
 */
export async function isReauthFresh(userId: string): Promise<boolean> {
  if (!redis) return true;
  const value = await redis.get<number>(key(userId));
  return value != null && Date.now() - value < REAUTH_WINDOW_MS;
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
