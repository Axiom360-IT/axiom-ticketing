import { Redis } from "@upstash/redis";

// Account lockout for repeated failed sign-ins (M16 Phase B). Per the
// spec: 5 failures within a 15-minute window locks the account for 15
// minutes. The lock is cleared on a successful sign-in or by an admin
// via `unlockUser`.
//
// Redis is the fast-path storage; the DB column `users.locked_until`
// is the durable mirror so the admin UI can show the lock state and the
// daily Inngest cleanup cron can age out forgotten rows. Both are kept
// in sync by the sign-in action.
//
// In dev without Upstash configured we fail OPEN (no lockout) — the
// startup warning in `lib/ratelimit.ts` covers the misconfiguration
// signal in production.

const HAS_UPSTASH = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);
const redis = HAS_UPSTASH ? Redis.fromEnv() : null;

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
export const FAILURE_WINDOW_SECONDS = 15 * 60;

const FAIL_PREFIX = "axiom:lockout:fail:";
const LOCK_PREFIX = "axiom:lockout:locked:";

function failKey(email: string) {
  return `${FAIL_PREFIX}${email.toLowerCase()}`;
}
function lockKey(email: string) {
  return `${LOCK_PREFIX}${email.toLowerCase()}`;
}

export type LockoutState = {
  locked: boolean;
  /** Wall-clock ms timestamp when the lock lifts (only set when `locked`). */
  retryAt?: number;
};

/** Read current lock state without mutating any counter. */
export async function getLockoutState(email: string): Promise<LockoutState> {
  if (!redis) return { locked: false };
  const value = await redis.get<number>(lockKey(email));
  if (!value) return { locked: false };
  // Stored value is the unix-ms unlock time. If clock skew or stale data
  // pushes it past now, treat as unlocked.
  if (value <= Date.now()) return { locked: false };
  return { locked: true, retryAt: value };
}

/**
 * Record a failed sign-in. Returns the post-increment state — when the
 * threshold trips, `justLocked` is true so the caller can fire the
 * notification email exactly once.
 */
export async function recordFailedAttempt(
  email: string,
): Promise<LockoutState & { justLocked: boolean; attempts: number }> {
  if (!redis) return { locked: false, justLocked: false, attempts: 0 };

  const key = failKey(email);
  const attempts = await redis.incr(key);
  if (attempts === 1) {
    // First failure in window — set the rolling window TTL.
    await redis.expire(key, FAILURE_WINDOW_SECONDS);
  }

  if (attempts < MAX_FAILED_ATTEMPTS) {
    return { locked: false, justLocked: false, attempts };
  }

  // Threshold met (or exceeded). Set the lock if not already held.
  const lk = lockKey(email);
  const retryAt = Date.now() + LOCKOUT_DURATION_MS;
  // NX = only set if absent — preserves the original lock window for
  // callers that exceed the threshold via concurrent requests.
  const set = await redis.set(lk, retryAt, {
    nx: true,
    px: LOCKOUT_DURATION_MS,
  });
  // `set` is "OK" when we won the race; null/undefined when a lock was
  // already in place. Re-read to return a stable retryAt.
  if (set !== "OK") {
    const existing = await redis.get<number>(lk);
    return {
      locked: true,
      justLocked: false,
      attempts,
      retryAt: existing ?? retryAt,
    };
  }
  // Reset the counter — they're locked now; future failures while locked
  // shouldn't extend the lock.
  await redis.del(key);
  return { locked: true, justLocked: true, attempts, retryAt };
}

/** Clear both the failure counter and any lock for `email`. */
export async function clearFailures(email: string): Promise<void> {
  if (!redis) return;
  await Promise.all([redis.del(failKey(email)), redis.del(lockKey(email))]);
}
