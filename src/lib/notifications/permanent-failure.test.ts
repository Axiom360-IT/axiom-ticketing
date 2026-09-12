import { describe, expect, it } from "vitest";
import { EmailSendError } from "@/lib/email/send-error";
import { isPermanentSendFailure } from "./permanent-failure";

// Getting a category wrong cuts both ways: mark a transient fault permanent and
// a recoverable send is dropped after one attempt; mark a permanent one
// transient and one fault becomes four failures.
describe("isPermanentSendFailure", () => {
  it("treats an exhausted Resend daily quota as permanent", () => {
    // The real production error: retrying at 30s/5min/30min still lands inside
    // the same day, so all three retries are guaranteed to fail.
    expect(
      isPermanentSendFailure(
        new EmailSendError("quota reached", "daily_quota_exceeded"),
      ),
    ).toBe(true);
  });

  it("treats a rejected Resend API key as permanent", () => {
    expect(
      isPermanentSendFailure(new EmailSendError("bad key", "invalid_api_key")),
    ).toBe(true);
  });

  it("keeps Resend's per-second rate limit RETRYABLE", () => {
    // The distinction that matters: rate_limit_exceeded is per-second and
    // backoff genuinely clears it, unlike the daily quota above.
    expect(
      isPermanentSendFailure(
        new EmailSendError("slow down", "rate_limit_exceeded"),
      ),
    ).toBe(false);
  });

  it("treats Twilio 20003 (bad credentials / suspended account) as permanent", () => {
    expect(isPermanentSendFailure({ code: 20003, message: "Authenticate" })).toBe(
      true,
    );
  });

  it("treats an invalid Twilio recipient as permanent", () => {
    expect(isPermanentSendFailure({ code: 21211 })).toBe(true);
  });

  it("keeps Twilio 20429 (too many requests) RETRYABLE", () => {
    expect(isPermanentSendFailure({ code: 20429 })).toBe(false);
  });

  it("treats anything unrecognized as retryable", () => {
    // Network faults, provider 5xx, and unknown shapes must keep their retries —
    // defaulting to "permanent" would silently drop recoverable sends.
    expect(isPermanentSendFailure(new Error("socket hang up"))).toBe(false);
    expect(isPermanentSendFailure(new EmailSendError("odd", undefined))).toBe(
      false,
    );
    expect(isPermanentSendFailure({ code: "20003" })).toBe(false);
    expect(isPermanentSendFailure(null)).toBe(false);
    expect(isPermanentSendFailure(undefined)).toBe(false);
  });
});
