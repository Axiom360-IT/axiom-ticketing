import { describe, expect, it } from "vitest";
import { computeInviteStatus } from "./invite-status";

describe("computeInviteStatus", () => {
  it("is active once accepted, regardless of expiry", () => {
    expect(
      computeInviteStatus({
        inviteAcceptedAt: new Date(),
        inviteExpiresAt: new Date(Date.now() - 1000),
      }),
    ).toBe("active");
  });

  it("is active when no invite was ever tracked (pre-dates the feature)", () => {
    expect(
      computeInviteStatus({ inviteAcceptedAt: null, inviteExpiresAt: null }),
    ).toBe("active");
  });

  it("is invited while unexpired and unaccepted", () => {
    expect(
      computeInviteStatus({
        inviteAcceptedAt: null,
        inviteExpiresAt: new Date(Date.now() + 60_000),
      }),
    ).toBe("invited");
  });

  it("is invite_expired once past expiry and still unaccepted", () => {
    expect(
      computeInviteStatus({
        inviteAcceptedAt: null,
        inviteExpiresAt: new Date(Date.now() - 60_000),
      }),
    ).toBe("invite_expired");
  });

  it("is invite_failed when the last send attempt failed, even if not yet expired", () => {
    expect(
      computeInviteStatus({
        inviteAcceptedAt: null,
        inviteExpiresAt: new Date(Date.now() + 60_000),
        inviteSendFailedAt: new Date(),
      }),
    ).toBe("invite_failed");
  });

  it("is active once accepted even if a send previously failed", () => {
    expect(
      computeInviteStatus({
        inviteAcceptedAt: new Date(),
        inviteExpiresAt: new Date(Date.now() + 60_000),
        inviteSendFailedAt: new Date(),
      }),
    ).toBe("active");
  });
});
