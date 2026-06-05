import { describe, expect, it } from "vitest";
import { senderAuthVerdict } from "./auth-results";

const h = (ar: string): Record<string, string> => ({
  "authentication-results": ar,
});

describe("senderAuthVerdict", () => {
  it("passes on a DMARC-aligned result", () => {
    expect(
      senderAuthVerdict(
        h(
          "mx.resend.com; spf=pass smtp.mailfrom=kingsmill.com; dkim=pass header.d=kingsmill.com; dmarc=pass header.from=kingsmill.com",
        ),
        "bob@kingsmill.com",
      ),
    ).toBe("pass");
  });

  it("fails on dmarc=fail (spoofed From)", () => {
    expect(
      senderAuthVerdict(
        h(
          "mx.resend.com; spf=fail smtp.mailfrom=evil.example; dkim=none; dmarc=fail header.from=kingsmill.com",
        ),
        "bob@kingsmill.com",
      ),
    ).toBe("fail");
  });

  it("passes on aligned DKIM when no DMARC verdict is present", () => {
    expect(
      senderAuthVerdict(
        h("mx.resend.com; spf=neutral; dkim=pass header.d=kingsmill.com"),
        "jane@kingsmill.com",
      ),
    ).toBe("pass");
  });

  it("passes on aligned DKIM for a sending subdomain (relaxed alignment)", () => {
    expect(
      senderAuthVerdict(
        h("mx.resend.com; dkim=pass header.d=mail.kingsmill.com"),
        "jane@kingsmill.com",
      ),
    ).toBe("pass");
  });

  it("passes on aligned SPF when no DMARC/DKIM verdict", () => {
    expect(
      senderAuthVerdict(
        h("mx.resend.com; spf=pass smtp.mailfrom=bob@kingsmill.com"),
        "bob@kingsmill.com",
      ),
    ).toBe("pass");
  });

  it("does NOT pass when DKIM passes for a DIFFERENT (unaligned) domain", () => {
    // A forwarder's DKIM signing its own domain must not authenticate a
    // spoofed From: of a different domain.
    expect(
      senderAuthVerdict(
        h("mx.resend.com; dkim=pass header.d=mailchimp.com; spf=pass smtp.mailfrom=mailchimp.com"),
        "bob@kingsmill.com",
      ),
    ).not.toBe("pass");
  });

  it("returns none when the header is absent", () => {
    expect(senderAuthVerdict({}, "bob@kingsmill.com")).toBe("none");
  });

  it("fails on a malformed From: address", () => {
    expect(
      senderAuthVerdict(h("mx.resend.com; dmarc=pass"), "not-an-email"),
    ).toBe("fail");
  });

  it("treats softfail/permerror as fail when nothing aligned passed", () => {
    expect(
      senderAuthVerdict(
        h("mx.resend.com; spf=softfail smtp.mailfrom=kingsmill.com"),
        "bob@kingsmill.com",
      ),
    ).toBe("fail");
  });
});
