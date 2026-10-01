import { describe, expect, it } from "vitest";
import {
  extractTicketNumber,
  normalizeResendInbound,
  type NormalizedInboundEmail,
} from "./inbound-payload";

describe("normalizeResendInbound", () => {
  it("normalizes a typical Resend payload (object headers)", () => {
    const out = normalizeResendInbound({
      type: "email.received",
      data: {
        from: { email: "alex@example.com", name: "Alex" },
        to: [{ email: "ticket+AX-0042@axiom360.it" }],
        subject: "Re: [AX-0042] Outlook crash",
        text: "Yes that fixed it.",
        html: "<p>Yes that fixed it.</p>",
        headers: { "Auto-Submitted": "no", "Message-Id": "<a@b>" },
      },
    });
    expect(out).not.toBeNull();
    expect(out!.fromEmail).toBe("alex@example.com");
    expect(out!.fromName).toBe("Alex");
    // Lower-cased: normalizeResendInbound normalizes addresses. The ticket
    // token survives because extractTicketNumber upper-cases what it matches.
    expect(out!.toEmails).toEqual(["ticket+ax-0042@axiom360.it"]);
    expect(out!.subject).toBe("Re: [AX-0042] Outlook crash");
    expect(out!.headers["auto-submitted"]).toBe("no");
    expect(out!.headers["message-id"]).toBe("<a@b>");
  });

  it("normalizes array-of-pairs headers (alternative Resend shape)", () => {
    const out = normalizeResendInbound({
      data: {
        from: "alex@example.com",
        to: ["ticket+AX-0007@axiom360.it"],
        subject: null,
        text: null,
        headers: [
          { name: "Auto-Submitted", value: "auto-replied" },
          { name: "X-Foo", value: "bar" },
        ],
      },
    });
    expect(out).not.toBeNull();
    expect(out!.fromEmail).toBe("alex@example.com");
    expect(out!.headers["auto-submitted"]).toBe("auto-replied");
  });

  it("returns null when the sender is missing or malformed", () => {
    expect(normalizeResendInbound({ data: { from: undefined } })).toBeNull();
    expect(normalizeResendInbound({ data: { from: "not-an-email" } })).toBeNull();
  });
});

describe("extractTicketNumber", () => {
  function fixture(over: Partial<NormalizedInboundEmail>): NormalizedInboundEmail {
    return {
      fromEmail: "alex@example.com",
      toEmails: [],
      subject: null,
      text: null,
      html: null,
      headers: {},
      ...over,
    };
  }

  it("finds the ticket number in a ticket+AX-XXXX@ address", () => {
    expect(
      extractTicketNumber(
        fixture({ toEmails: ["ticket+AX-0042@axiom360.it"] }),
      ),
    ).toBe("AX-0042");
  });

  it("finds the ticket number in the subject line", () => {
    expect(
      extractTicketNumber(
        fixture({ subject: "Re: [AX-0099] still broken" }),
      ),
    ).toBe("AX-0099");
  });

  it("falls back to In-Reply-To when To/Subject lack the marker", () => {
    expect(
      extractTicketNumber(
        fixture({
          subject: "Re: my issue",
          headers: { "in-reply-to": "<AX-0123.thread@axiom360.it>" },
        }),
      ),
    ).toBe("AX-0123");
  });

  it("falls back to References header", () => {
    expect(
      extractTicketNumber(
        fixture({ headers: { references: "<AX-0500.thread@axiom360.it>" } }),
      ),
    ).toBe("AX-0500");
  });

  it("uppercases lowercase matches", () => {
    expect(
      extractTicketNumber(fixture({ toEmails: ["ticket+ax-0042@axiom360.it"] })),
    ).toBe("AX-0042");
  });

  it("finds the new org-prefixed number in a ticket+ address", () => {
    expect(
      extractTicketNumber(
        fixture({ toEmails: ["ticket+KI-20260522-001@axiom360.it"] }),
      ),
    ).toBe("KI-20260522-001");
  });

  it("finds the new org-prefixed number in the subject line", () => {
    expect(
      extractTicketNumber(
        fixture({ subject: "Re: [KI-20260522-007] still broken" }),
      ),
    ).toBe("KI-20260522-007");
  });

  it("returns null when no marker is present anywhere", () => {
    expect(extractTicketNumber(fixture({}))).toBeNull();
  });

  it("prefers To-address marker over Subject", () => {
    expect(
      extractTicketNumber(
        fixture({
          toEmails: ["ticket+AX-0001@axiom360.it"],
          subject: "Mentions [AX-0999] but is replying to AX-0001",
        }),
      ),
    ).toBe("AX-0001");
  });
});

describe("normalizeResendInbound — cc recipients", () => {
  // These feed participant harvesting, so whatever lands in ccEmails becomes a
  // row in ticket_participants. Nothing downstream re-validates the shape.
  it("takes structured cc entries", () => {
    const out = normalizeResendInbound({
      data: {
        from: "alex@example.com",
        to: [{ email: "ticket+AX-0042@axiom360.it" }],
        cc: [{ email: "rob@kingsmillfoods.com" }, { email: "pat@acme.co" }],
        subject: "Re: [AX-0042] VPN",
        text: "looping in rob",
      },
    });
    expect(out!.ccEmails).toEqual([
      "rob@kingsmillfoods.com",
      "pat@acme.co",
    ]);
  });

  it("strips a display name instead of storing it as the address", () => {
    const out = normalizeResendInbound({
      data: {
        from: "alex@example.com",
        to: ["Support Desk <ticket+AX-0042@axiom360.it>"],
        cc: "Rob Smith <rob@kingsmillfoods.com>",
        subject: "Re: [AX-0042] VPN",
        text: "looping in rob",
      },
    });
    // Not `"rob smith <rob@kingsmillfoods.com>"` — that has no parseable
    // domain and would reach the moderation queue as a bogus address.
    expect(out!.ccEmails).toContain("rob@kingsmillfoods.com");
    expect(out!.ccEmails!.every((e) => !e.includes("<"))).toBe(true);
    expect(out!.toEmails).toEqual(["ticket+ax-0042@axiom360.it"]);
  });

  it("falls back to the raw Cc header, deduped against structured entries", () => {
    const out = normalizeResendInbound({
      data: {
        from: "alex@example.com",
        to: [{ email: "ticket+AX-0042@axiom360.it" }],
        cc: [{ email: "rob@kingsmillfoods.com" }],
        subject: "Re: [AX-0042] VPN",
        text: "hi",
        headers: {
          Cc: "Rob Smith <rob@kingsmillfoods.com>, pat@acme.co",
        },
      },
    });
    expect(out!.ccEmails).toContain("rob@kingsmillfoods.com");
    expect(out!.ccEmails).toContain("pat@acme.co");
    // Deduped — rob arrives from both sources.
    expect(
      out!.ccEmails!.filter((e) => e === "rob@kingsmillfoods.com"),
    ).toHaveLength(1);
  });

  it("leaves ccEmails empty when there are no cc recipients", () => {
    const out = normalizeResendInbound({
      data: {
        from: "alex@example.com",
        to: [{ email: "ticket+AX-0042@axiom360.it" }],
        subject: "Re: [AX-0042] VPN",
        text: "hi",
      },
    });
    expect(out!.ccEmails ?? []).toEqual([]);
  });
});
