import { describe, expect, it } from "vitest";
import {
  buildOutboundMessageId,
  collectReferencedMessageIds,
  normalizeMessageId,
  parseMessageIds,
} from "./message-id";

describe("normalizeMessageId", () => {
  it("strips angle brackets, trims, and lowercases", () => {
    expect(normalizeMessageId("  <ABC@Host.COM>  ")).toBe("abc@host.com");
  });

  it("accepts a bare id without brackets", () => {
    expect(normalizeMessageId("id123@mail.gmail.com")).toBe(
      "id123@mail.gmail.com",
    );
  });

  it("rejects empty, null, and id-less values", () => {
    expect(normalizeMessageId(null)).toBeNull();
    expect(normalizeMessageId(undefined)).toBeNull();
    expect(normalizeMessageId("")).toBeNull();
    expect(normalizeMessageId("<>")).toBeNull();
    expect(normalizeMessageId("no-at-sign")).toBeNull();
  });

  it("rejects absurdly long ids", () => {
    expect(normalizeMessageId(`<${"x".repeat(500)}@h>`)).toBeNull();
  });
});

describe("parseMessageIds", () => {
  it("returns [] for empty/undefined", () => {
    expect(parseMessageIds(undefined)).toEqual([]);
    expect(parseMessageIds("")).toEqual([]);
  });

  it("extracts a single bracketed id", () => {
    expect(parseMessageIds("<a@b.com>")).toEqual(["a@b.com"]);
  });

  it("extracts every id from a whitespace/newline-separated References list", () => {
    const header = "<one@x.com>\r\n <two@y.com>\t<three@z.com>";
    expect(parseMessageIds(header)).toEqual([
      "one@x.com",
      "two@y.com",
      "three@z.com",
    ]);
  });

  it("de-duplicates repeated ids preserving order", () => {
    expect(parseMessageIds("<a@x> <a@x> <b@y>")).toEqual(["a@x", "b@y"]);
  });

  it("caps a pathologically long header", () => {
    const many = Array.from({ length: 200 }, (_, i) => `<m${i}@h>`).join(" ");
    expect(parseMessageIds(many).length).toBe(50);
  });
});

describe("collectReferencedMessageIds", () => {
  it("merges In-Reply-To and References, de-duplicated, in order", () => {
    const headers = {
      "in-reply-to": "<reply@x.com>",
      references: "<root@x.com> <reply@x.com>",
    };
    expect(collectReferencedMessageIds(headers)).toEqual([
      "reply@x.com",
      "root@x.com",
    ]);
  });

  it("returns [] when neither header is present", () => {
    expect(collectReferencedMessageIds({})).toEqual([]);
  });
});

describe("buildOutboundMessageId", () => {
  it("embeds the ticket number and is uniquely bracketed", () => {
    const a = buildOutboundMessageId("BRAN-20260730-001", "support.axiom360.it");
    const b = buildOutboundMessageId("BRAN-20260730-001", "support.axiom360.it");
    expect(a).toMatch(
      /^<ticket\.BRAN-20260730-001\.[0-9a-f-]{36}@support\.axiom360\.it>$/,
    );
    expect(a).not.toBe(b); // random component differs per send
  });

  it("round-trips: the embedded number survives normalization", () => {
    const id = buildOutboundMessageId("KING-20260730-001", "support.axiom360.it");
    const norm = normalizeMessageId(id);
    expect(norm).toContain("king-20260730-001");
  });
});
