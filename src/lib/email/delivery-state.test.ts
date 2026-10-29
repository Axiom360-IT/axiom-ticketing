import { describe, expect, it } from "vitest";
import {
  type IssueRecord,
  isDelivered,
  normalizeAddress,
  parseResendTime,
  problemStatus,
  reconcile,
  type ResendEmail,
} from "./delivery-state";
import { isNoReplyAddress } from "./automated-address";

let n = 0;
const mail = (to: string, last_event: string, iso: string, subject = "Re: x"): ResendEmail => ({
  id: `e${++n}`,
  to: [to],
  subject,
  created_at: iso,
  last_event,
});
const T = (h: number) => `2026-10-29T${String(h).padStart(2, "0")}:00:00.000Z`;
const none = new Map<string, IssueRecord>();

const open = (email: string, over: Partial<IssueRecord> = {}): IssueRecord => ({
  email,
  status: "suppressed",
  firstSeenAt: new Date(T(10)),
  lastSeenAt: new Date(T(12)),
  lastEmailId: "old",
  lastSubject: "s",
  resolvedAt: null,
  ...over,
});

describe("classification", () => {
  it("separates problems, deliveries and everything else", () => {
    expect(problemStatus("suppressed")).toBe("suppressed");
    expect(problemStatus("bounced")).toBe("bounced");
    expect(problemStatus("complained")).toBe("complained");
    for (const e of ["delivered", "sent", "failed", "delivery_delayed", "opened"]) {
      expect(problemStatus(e), e).toBeNull();
    }
    expect(isDelivered("delivered")).toBe(true);
    expect(isDelivered("opened")).toBe(true);
    expect(isDelivered("suppressed")).toBe(false);
    expect(isDelivered("sent")).toBe(false);
  });

  it("reads an address out of a display-name form", () => {
    expect(normalizeAddress("Michele <MMilton@Merry.CA>")).toBe("mmilton@merry.ca");
    expect(normalizeAddress("a@b.co")).toBe("a@b.co");
    expect(normalizeAddress("not an address")).toBeNull();
  });
});

describe("reconcile — opening", () => {
  it("opens an issue for a suppressed address", () => {
    const out = reconcile([mail("m@x.ca", "suppressed", T(14))], none);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ email: "m@x.ca", status: "suppressed", resolvedAt: null });
  });

  it("keeps the earliest sighting as 'since' and the latest as 'last seen'", () => {
    const out = reconcile(
      [
        mail("m@x.ca", "suppressed", T(14)),
        mail("m@x.ca", "suppressed", T(9)),
        mail("m@x.ca", "suppressed", T(16)),
      ],
      none,
    );
    expect(out[0]?.firstSeenAt.toISOString()).toBe(T(9));
    expect(out[0]?.lastSeenAt.toISOString()).toBe(T(16));
  });

  it("uses the status of the MOST RECENT problem", () => {
    const out = reconcile(
      [mail("m@x.ca", "bounced", T(9)), mail("m@x.ca", "complained", T(15))],
      none,
    );
    expect(out[0]?.status).toBe("complained");
  });

  it("does not let a window that no longer reaches back lose the original 'since'", () => {
    const known = open("m@x.ca", { firstSeenAt: new Date(T(1)) });
    const out = reconcile([mail("m@x.ca", "suppressed", T(20))], new Map([["m@x.ca", known]]));
    expect(out[0]?.firstSeenAt.toISOString()).toBe(T(1));
  });

  it("re-opens a resolved issue when it goes wrong again", () => {
    const known = open("m@x.ca", { resolvedAt: new Date(T(13)) });
    const out = reconcile([mail("m@x.ca", "bounced", T(18))], new Map([["m@x.ca", known]]));
    expect(out[0]).toMatchObject({ status: "bounced", resolvedAt: null });
  });
});

describe("reconcile — healing", () => {
  it("resolves an open issue once a LATER message is delivered", () => {
    const known = open("m@x.ca");
    const out = reconcile([mail("m@x.ca", "delivered", T(15))], new Map([["m@x.ca", known]]));
    expect(out).toHaveLength(1);
    expect(out[0]?.resolvedAt?.toISOString()).toBe(T(15));
  });

  it("does NOT resolve on a delivery that came BEFORE the last problem", () => {
    const known = open("m@x.ca", { lastSeenAt: new Date(T(16)) });
    const out = reconcile([mail("m@x.ca", "delivered", T(14))], new Map([["m@x.ca", known]]));
    expect(out).toEqual([]);
  });

  it("lets the more recent of problem and delivery win in the same window", () => {
    const fixed = reconcile(
      [mail("m@x.ca", "suppressed", T(10)), mail("m@x.ca", "delivered", T(12))],
      new Map([["m@x.ca", open("m@x.ca", { lastSeenAt: new Date(T(10)) })]]),
    );
    expect(fixed[0]?.resolvedAt).not.toBeNull();

    const broken = reconcile(
      [mail("m@x.ca", "delivered", T(10)), mail("m@x.ca", "suppressed", T(12))],
      none,
    );
    expect(broken[0]).toMatchObject({ status: "suppressed", resolvedAt: null });
  });

  it("creates NOTHING for an address that was only ever delivered", () => {
    expect(reconcile([mail("ok@x.ca", "delivered", T(10))], none)).toEqual([]);
  });

  it("creates nothing for a past problem that was already fixed before we looked", () => {
    const out = reconcile(
      [mail("m@x.ca", "suppressed", T(9)), mail("m@x.ca", "delivered", T(12))],
      none,
    );
    expect(out).toEqual([]);
  });
});

describe("reconcile — ignoring", () => {
  it("ignores a message still in flight", () => {
    expect(reconcile([mail("m@x.ca", "sent", T(10))], none)).toEqual([]);
    expect(reconcile([mail("m@x.ca", "delivery_delayed", T(10))], none)).toEqual([]);
  });

  it("does not blame the recipient for OUR failure to send", () => {
    // `failed` is a bad key or an exhausted quota. Flagging a customer for it
    // would send an agent chasing the wrong person.
    expect(reconcile([mail("m@x.ca", "failed", T(10))], none)).toEqual([]);
  });

  it("a pending message does not mask an open problem", () => {
    const known = open("m@x.ca");
    const out = reconcile([mail("m@x.ca", "sent", T(20))], new Map([["m@x.ca", known]]));
    expect(out).toEqual([]);
  });

  it("skips malformed timestamps and addresses without throwing", () => {
    expect(() =>
      reconcile(
        [
          { id: "a", to: ["x@y.ca"], subject: "s", created_at: "garbage", last_event: "suppressed" },
          { id: "b", to: ["nope"], subject: "s", created_at: T(10), last_event: "suppressed" },
        ],
        none,
      ),
    ).not.toThrow();
  });
});

describe("reconcile — idempotence", () => {
  it("returns nothing the second time over the same window", () => {
    const window = [mail("m@x.ca", "suppressed", T(9)), mail("m@x.ca", "suppressed", T(14))];
    const first = reconcile(window, none);
    const known = new Map(first.map((r) => [r.email, r]));
    expect(reconcile(window, known)).toEqual([]);
  });
});

describe("isNoReplyAddress", () => {
  it("catches the no-reply mailboxes by name", () => {
    for (const a of [
      "noreply@mailsender.sentinelone.net",
      "no-reply@x.com",
      "DoNotReply@x.com",
      "do-not-reply@central.sophos.com",
      "mailer-daemon@x.com",
      "MicrosoftExchange329e71ec88ae4615bbc36ab6ce41109e@kingsmillfoods.com",
    ]) {
      expect(isNoReplyAddress(a), a).toBe(true);
    }
  });

  it("leaves real people alone — whole local-parts, never substrings", () => {
    for (const a of ["donna.reply@x.com", "noreply.fan@x.com", "replyto@x.com", "jo@x.com", "support@x.com", "backup@n-able.com"]) {
      expect(isNoReplyAddress(a), a).toBe(false);
    }
  });

  it("tolerates junk", () => {
    expect(isNoReplyAddress("")).toBe(false);
    expect(isNoReplyAddress("@x.com")).toBe(false);
    expect(isNoReplyAddress("nope")).toBe(false);
  });
});

describe("parseResendTime", () => {
  it("reads the exact format Resend returns", () => {
    // Taken verbatim from the live API.
    expect(parseResendTime("2026-10-29 20:07:12.328000+00")).toBe(
      Date.parse("2026-10-29T20:07:12.328Z"),
    );
  });

  it("reads the variants it could plausibly send", () => {
    const want = Date.parse("2026-10-29T20:07:12Z");
    expect(parseResendTime("2026-10-29 20:07:12+00")).toBe(want);
    expect(parseResendTime("2026-10-29T20:07:12Z")).toBe(want);
    expect(parseResendTime("2026-10-29T20:07:12+00:00")).toBe(want);
  });

  it("honours a real offset", () => {
    expect(parseResendTime("2026-10-29 16:07:12-04")).toBe(
      Date.parse("2026-10-29T20:07:12Z"),
    );
  });

  it("orders two events correctly across the real format", () => {
    expect(parseResendTime("2026-10-29 14:41:20.1+00")).toBeGreaterThan(
      parseResendTime("2026-10-29 14:41:18.9+00"),
    );
  });

  it("returns NaN for junk instead of a plausible wrong date", () => {
    expect(Number.isNaN(parseResendTime("yesterday"))).toBe(true);
    expect(Number.isNaN(parseResendTime(""))).toBe(true);
  });
});
