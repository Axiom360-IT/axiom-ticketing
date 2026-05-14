// Pure request helpers, safe for edge runtime. No node:* imports.

/**
 * Returns the canonical app origin (no trailing slash). Throws in production
 * if `NEXT_PUBLIC_APP_URL` is unset; falls back to `http://localhost:3000`
 * during dev/test so local flows don't break when the env var is absent.
 */
export function getAppUrl(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL;
  if (!u) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("NEXT_PUBLIC_APP_URL must be set in production");
    }
    return "http://localhost:3000";
  }
  return u.replace(/\/+$/, "");
}

/**
 * Extracts the client IP from request headers. Trusts the leftmost
 * X-Forwarded-For value, which is correct on Vercel (which sanitizes the
 * header) and safe on any reverse proxy that strips/replaces it. Self-hosted
 * deployments behind unsanitized proxies should pin this behind an env knob.
 */
export function clientIp(headers: Headers, fallback = "unknown"): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || fallback;
  return headers.get("x-real-ip") ?? fallback;
}
