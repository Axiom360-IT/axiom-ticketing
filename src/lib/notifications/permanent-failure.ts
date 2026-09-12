import { EmailSendError } from "@/lib/email/send-error";

// Which send failures are worth retrying, and which are just noise.
//
// Inngest retries a failed function 3 times with backoff, which is right for a
// transient fault (network blip, provider 5xx, momentary rate limit). It is
// wrong for a failure whose cause cannot change between attempts — a rejected
// API key, an exhausted daily quota, an invalid recipient. Those retries can't
// succeed, and each one is another failed POST to /api/inngest: one real
// problem shows up as four failures, which is what turned a handful of genuine
// faults into the "72 failed requests in 5 minutes" Vercel alarm.
//
// Classified here so both senders agree, and so the reasoning lives in one
// place rather than being re-derived at each call site.

// Resend's own error names (returned as `{ error: { name } }`).
const PERMANENT_RESEND_ERRORS = new Set([
  "daily_quota_exceeded", // plan limit — resets tomorrow, not in 30s
  "invalid_api_key",
  "restricted_api_key",
  "missing_api_key",
  "validation_error", // malformed recipient/sender — identical next time
  "invalid_from_address",
  "invalid_to_address",
  "not_found",
]);
// Deliberately NOT permanent: `rate_limit_exceeded` is Resend's per-SECOND
// limit, which backoff genuinely clears — the opposite of daily_quota_exceeded.

// Twilio surfaces a numeric `code` on its errors.
const PERMANENT_TWILIO_CODES = new Set([
  20003, // authenticate — bad SID/token, or a suspended (e.g. unpaid) account
  20404, // resource not found
  21211, // invalid 'To' number
  21212, // invalid 'From' number
  21606, // 'From' not a valid, SMS-capable number on this account
  21608, // trial account: unverified recipient
  21610, // recipient has unsubscribed
  21614, // 'To' is not a mobile number
]);
// Deliberately NOT permanent: 20429 (too many requests) and any 5xx — those are
// exactly what backoff exists for.

function twilioCode(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === "number" ? code : null;
}

/**
 * True when retrying this send cannot possibly succeed — a human has to change
 * a credential, a plan, or the recipient. The caller should surface it once
 * (as an Inngest NonRetriableError) instead of burning the retry budget.
 */
export function isPermanentSendFailure(err: unknown): boolean {
  if (err instanceof EmailSendError) {
    return (
      err.resendErrorName !== undefined &&
      PERMANENT_RESEND_ERRORS.has(err.resendErrorName)
    );
  }
  const code = twilioCode(err);
  if (code !== null) return PERMANENT_TWILIO_CODES.has(code);
  return false;
}
