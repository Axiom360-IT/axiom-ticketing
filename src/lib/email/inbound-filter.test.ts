import { describe, expect, it } from "vitest";
import {
  type ParsedInbound,
  shouldAcceptInbound,
  stripQuotesAndSignatures,
} from "./inbound-filter";

function fixture(
  headers: Record<string, string>,
  opts: { subject?: string | null; text?: string | null } = {},
): ParsedInbound {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(headers)) map.set(k.toLowerCase(), v);
  return {
    headers: map,
    subject: opts.subject ?? null,
    text: opts.text ?? "Hi there, this is a reply with real content.",
  };
}

describe("shouldAcceptInbound — accepts genuine replies", () => {
  it("accepts a normal reply with no special headers", () => {
    expect(
      shouldAcceptInbound(
        fixture(
          {},
          {
            subject: "Re: [AX-0042] Outlook crashes",
            text: "Yes that fixed it, thanks!",
          },
        ),
      ),
    ).toEqual({ accept: true });
  });

  it("accepts when Auto-Submitted is explicitly 'no'", () => {
    expect(
      shouldAcceptInbound(
        fixture(
          { "Auto-Submitted": "no" },
          { subject: "Re: hello", text: "All good." },
        ),
      ),
    ).toEqual({ accept: true });
  });

  it("accepts despite a quoted history (reply still has new text on top)", () => {
    const text = `Looks fixed now, cheers.

On Mon, Jan 8, 2026 at 11:14, Priya <priya@axiom.it> wrote:
> Try clearing the cache.
> -- Priya`;
    expect(
      shouldAcceptInbound(fixture({}, { subject: "Re: ticket", text })),
    ).toEqual({ accept: true });
  });
});

describe("shouldAcceptInbound — auto-replies and vacation responders", () => {
  it("rejects RFC 3834 Auto-Submitted: auto-replied", () => {
    expect(
      shouldAcceptInbound(
        fixture({ "Auto-Submitted": "auto-replied" }, { text: "I'm OOO." }),
      ),
    ).toEqual({ accept: false, reason: "auto-submitted" });
  });

  it("rejects Auto-Submitted: auto-generated", () => {
    expect(
      shouldAcceptInbound(
        fixture({ "Auto-Submitted": "auto-generated" }, { text: "ack" }),
      ),
    ).toEqual({ accept: false, reason: "auto-submitted" });
  });

  it("rejects Outlook X-Autoreply", () => {
    expect(
      shouldAcceptInbound(
        fixture(
          { "X-Autoreply": "yes" },
          { subject: "Out of office", text: "Back next week." },
        ),
      ),
    ).toEqual({ accept: false, reason: "vacation-responder" });
  });

  it("rejects X-Autorespond (older Outlook)", () => {
    expect(
      shouldAcceptInbound(fixture({ "X-Autorespond": "true" })),
    ).toEqual({ accept: false, reason: "vacation-responder" });
  });

  it("rejects X-Auto-Response-Suppress", () => {
    expect(
      shouldAcceptInbound(fixture({ "X-Auto-Response-Suppress": "All" })),
    ).toEqual({ accept: false, reason: "vacation-responder" });
  });
});

describe("shouldAcceptInbound — bounces", () => {
  it("rejects empty Return-Path (<>)", () => {
    expect(
      shouldAcceptInbound(
        fixture({ "Return-Path": "<>" }, { subject: "Re: hi", text: "x" }),
      ),
    ).toEqual({ accept: false, reason: "bounce-empty-return-path" });
  });

  it("rejects whitespace Return-Path", () => {
    expect(
      shouldAcceptInbound(fixture({ "Return-Path": "   " })),
    ).toEqual({ accept: false, reason: "bounce-empty-return-path" });
  });

  it("rejects 'Undeliverable' subject", () => {
    expect(
      shouldAcceptInbound(
        fixture(
          {},
          { subject: "Undeliverable: Your message", text: "Bounce body." },
        ),
      ),
    ).toEqual({ accept: false, reason: "bounce-subject" });
  });

  it("rejects 'Mail Delivery Failed' subject", () => {
    expect(
      shouldAcceptInbound(
        fixture({}, { subject: "Mail delivery failed: returning to sender" }),
      ),
    ).toEqual({ accept: false, reason: "bounce-subject" });
  });

  it("rejects 'Failure Notice' (Gmail bounces)", () => {
    expect(
      shouldAcceptInbound(fixture({}, { subject: "Failure Notice" })),
    ).toEqual({ accept: false, reason: "bounce-subject" });
  });
});

describe("shouldAcceptInbound — mailing-list mail", () => {
  it("rejects messages with List-Id", () => {
    expect(
      shouldAcceptInbound(
        fixture({ "List-Id": "<announce.example.com>" }, { text: "Newsletter content" }),
      ),
    ).toEqual({ accept: false, reason: "list-mail" });
  });

  it("rejects messages with List-Unsubscribe", () => {
    expect(
      shouldAcceptInbound(
        fixture({ "List-Unsubscribe": "<https://example.com/unsub>" }),
      ),
    ).toEqual({ accept: false, reason: "list-mail" });
  });

  it("rejects Precedence: bulk", () => {
    expect(
      shouldAcceptInbound(fixture({ Precedence: "bulk" })),
    ).toEqual({ accept: false, reason: "precedence-bulk" });
  });

  it("rejects Precedence: list", () => {
    expect(
      shouldAcceptInbound(fixture({ Precedence: "list" })),
    ).toEqual({ accept: false, reason: "precedence-bulk" });
  });
});

describe("shouldAcceptInbound — empty bodies", () => {
  it("rejects empty text", () => {
    expect(
      shouldAcceptInbound(fixture({}, { subject: "Re: hi", text: "" })),
    ).toEqual({ accept: false, reason: "empty-body" });
  });

  it("rejects body that's only a quoted reply", () => {
    const text = `On Mon, Jan 8, 2026 at 11:14, Priya <priya@axiom.it> wrote:
> Try clearing the cache.`;
    expect(
      shouldAcceptInbound(fixture({}, { text })),
    ).toEqual({ accept: false, reason: "empty-body" });
  });

  it("rejects body that's only a signature", () => {
    const text = `
--
Sent from my iPhone`;
    expect(
      shouldAcceptInbound(fixture({}, { text })),
    ).toEqual({ accept: false, reason: "empty-body" });
  });
});

describe("stripQuotesAndSignatures", () => {
  it("returns reply text above a Gmail-style quote", () => {
    const text = `Thanks, that worked.

On Mon, Jan 8, 2026 at 11:14, Priya <priya@axiom.it> wrote:
> Try clearing the cache.`;
    expect(stripQuotesAndSignatures(text)).toBe("Thanks, that worked.");
  });

  it("returns reply text above an Outlook 'From: …' block", () => {
    const text = `Yes please proceed.

From: Priya <priya@axiom.it>
Sent: Monday, January 8, 2026 11:14 AM
To: Alex Dean
Subject: Your ticket
…snip…`;
    expect(stripQuotesAndSignatures(text)).toBe("Yes please proceed.");
  });

  it("removes a trailing '-- ' signature", () => {
    const text = `Issue is back.

--
Alex Dean
alex@example.com`;
    expect(stripQuotesAndSignatures(text)).toBe("Issue is back.");
  });

  it("strips '>'-prefixed quote lines that survive truncation", () => {
    const text = `Right answer:
> wrong answer
final word`;
    expect(stripQuotesAndSignatures(text)).toBe("Right answer:\nfinal word");
  });

  it("strips a Gmail attribution line that wrapped across two lines", () => {
    // HTML→text conversion can put "wrote:" on its own line after the email
    // address — the stripper must still catch the whole attribution.
    const text = `thank you for picking up my tikcet

On Fri, Jun 5, 2026 at 10:11 PM Axiom360 Support <ops@support.axiom360.it>
wrote:
> Your ticket has been assigned.`;
    expect(stripQuotesAndSignatures(text)).toBe(
      "thank you for picking up my tikcet",
    );
  });

  it("returns empty string for input that's only a quote", () => {
    const text = `On Mon, Jan 8, 2026, Priya wrote:
> hi`;
    expect(stripQuotesAndSignatures(text).trim()).toBe("");
  });

  it("handles missing input safely", () => {
    expect(stripQuotesAndSignatures("")).toBe("");
  });
});
