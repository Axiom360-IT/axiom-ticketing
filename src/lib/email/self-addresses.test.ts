import { describe, expect, it } from "vitest";
import { buildSelfAddressFilter, isTicketSubAddress } from "./self-addresses";

const isSelf = buildSelfAddressFilter({
  supportEmail: "Support@Axiom360.it",
  senderEmails: ["no-reply@axiom360.it", null, undefined],
  inboundDomain: "support.axiom360.it",
  internalDomains: ["axiom-internal.com"],
});

describe("buildSelfAddressFilter", () => {
  it("rejects the ticket reply-to sub-address in any case", () => {
    expect(isSelf("ticket+AX-0042@support.axiom360.it")).toBe(true);
    expect(isSelf("TICKET+KI-20260522-001@whatever.com")).toBe(true);
    expect(isTicketSubAddress("ticket+AX-1@x.com")).toBe(true);
  });

  it("rejects anything at the inbound domain — ops@ included", () => {
    expect(isSelf("ops@support.axiom360.it")).toBe(true);
    expect(isSelf("anything@support.axiom360.it")).toBe(true);
  });

  it("rejects the configured support and sender addresses, case-insensitively", () => {
    expect(isSelf("support@axiom360.it")).toBe(true);
    expect(isSelf("SUPPORT@AXIOM360.IT")).toBe(true);
    expect(isSelf("no-reply@axiom360.it")).toBe(true);
  });

  it("rejects configured internal domains", () => {
    expect(isSelf("someone@axiom-internal.com")).toBe(true);
  });

  it("rejects unusable input rather than letting it through", () => {
    expect(isSelf(null)).toBe(true);
    expect(isSelf("")).toBe(true);
    expect(isSelf("not-an-email")).toBe(true);
    expect(isSelf("@nolocal.com")).toBe(true);
  });

  it("accepts a genuine third-party address", () => {
    expect(isSelf("mwilson@golfcanada.ca")).toBe(false);
    expect(isSelf("jamie@kingsmillfoods.com")).toBe(false);
  });

  it("does not treat the main brand domain as ours unless configured", () => {
    // axiom360.it itself is only blocked via the explicit support/sender
    // entries — a staff member's own mailbox there can still participate.
    expect(isSelf("m.luqman@axiom360.it")).toBe(false);
  });
});
