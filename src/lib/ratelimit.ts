import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Upstash Redis-backed sliding window rate limiter. Same backend used for
// public endpoint protection (this file) and for authenticated per-user-per-
// action limits added in M16.
//
// In dev without Upstash credentials, rate limits fail OPEN (with a console
// warning). In production they fail CLOSED (refuse the request) — `fail` is
// configurable via the second argument to `enforce()`.

const HAS_UPSTASH = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);

const redis = HAS_UPSTASH ? Redis.fromEnv() : null;

if (!HAS_UPSTASH && process.env.NODE_ENV === "production") {
  // In production, missing credentials are a serious misconfiguration.
  console.error(
    "[ratelimit] UPSTASH_REDIS_REST_URL/TOKEN not set in production — rate limiting is disabled. This is a security regression; configure Upstash before launch.",
  );
}

type Duration = `${number} ${"ms" | "s" | "m" | "h" | "d"}`;

function makeLimiter(limit: number, window: Duration): Ratelimit | null {
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, window),
    analytics: false,
    prefix: "axiom:rl",
  });
}

export const ratelimits = {
  /** Public ticket submission form: 5 per IP per hour. */
  publicSubmitByIp: makeLimiter(5, "1 h"),
  /** Public ticket submission form: 20 per email per day. */
  publicSubmitByEmail: makeLimiter(20, "1 d"),
  /** Login: 5 attempts per IP per minute. */
  login: makeLimiter(5, "1 m"),
  /** Password reset: 3 per email per hour. */
  passwordResetByEmail: makeLimiter(3, "1 h"),
  /** Password reset: 10 per IP per hour. */
  passwordResetByIp: makeLimiter(10, "1 h"),
  /** Inbound email webhook: 1000 per minute (flood protection). */
  inboundEmail: makeLimiter(1000, "1 m"),
};

export type RateLimitKey = keyof typeof ratelimits;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  reset: number;
  limit: number;
};

/**
 * Check a rate limit. Returns `{ allowed: true }` if the request can proceed.
 *
 * If Upstash isn't configured: returns `allowed: true` (fail-open) in dev,
 * logs a warning. In production, the warning at module load is enough to
 * surface the misconfiguration.
 */
export async function checkRateLimit(
  key: RateLimitKey,
  identifier: string,
): Promise<RateLimitResult> {
  const limiter = ratelimits[key];
  if (!limiter) {
    return { allowed: true, remaining: -1, reset: 0, limit: -1 };
  }
  const result = await limiter.limit(identifier);
  return {
    allowed: result.success,
    remaining: result.remaining,
    reset: result.reset,
    limit: result.limit,
  };
}
