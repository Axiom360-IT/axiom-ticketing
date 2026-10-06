// Provider error names we have operator-facing wording for.
//
// The UI builds its message key as `failure.${code}`, which the literal-key
// i18n scanner cannot see — so this list exists to be asserted against
// en.json by a test. Without it, adding a code here and forgetting the
// wording would render "automations.reports.failure.whatever" to an operator
// at exactly the moment something is already going wrong.
//
// Overlaps lib/notifications/permanent-failure.ts but is NOT the same set and
// must not be derived from it: that list answers "is retrying pointless?",
// this one answers "can we explain it in a sentence?". `rate_limit_exceeded`
// is the clearest divergence — worth retrying, and worth explaining.
//
// A code absent from here is not a failure of this module: the UI falls back
// to the provider's own message, which is worse reading but still true.

export const DESCRIBED_SEND_FAILURES = [
  "daily_quota_exceeded",
  "rate_limit_exceeded",
  "invalid_api_key",
  "restricted_api_key",
  "missing_api_key",
  "invalid_to_address",
  "invalid_from_address",
  "validation_error",
  "not_found",
] as const;

export type DescribedSendFailure = (typeof DESCRIBED_SEND_FAILURES)[number];

const SET = new Set<string>(DESCRIBED_SEND_FAILURES);

export function isDescribedSendFailure(
  code: string | null | undefined,
): code is DescribedSendFailure {
  return typeof code === "string" && SET.has(code);
}
