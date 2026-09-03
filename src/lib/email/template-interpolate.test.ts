import { describe, expect, it } from "vitest";
import { interpolate, placeholdersIn } from "./template-interpolate";

describe("interpolate", () => {
  it("substitutes known placeholders", () => {
    expect(
      interpolate("Ticket {ticketNumber} — {subject}", {
        ticketNumber: "AX-0042",
        subject: "Outlook broken",
      }),
    ).toBe("Ticket AX-0042 — Outlook broken");
  });

  it("repeats a placeholder used more than once", () => {
    expect(interpolate("{a} then {a}", { a: "x" })).toBe("x then x");
  });

  it("leaves an unknown placeholder verbatim rather than throwing", () => {
    expect(interpolate("Hi {nope}", { name: "Alex" })).toBe("Hi {nope}");
  });

  it("returns the text unchanged when no values are supplied", () => {
    expect(interpolate("Hi {name}")).toBe("Hi {name}");
  });

  it("coerces non-string values", () => {
    expect(interpolate("{count} open", { count: 3 })).toBe("3 open");
  });

  it("does not treat inherited object properties as values", () => {
    expect(interpolate("{toString}", {})).toBe("{toString}");
  });
});

describe("placeholdersIn", () => {
  it("lists distinct tokens in first-seen order", () => {
    expect(placeholdersIn("{b} {a} {b} {c}")).toEqual(["b", "a", "c"]);
  });

  it("returns an empty list for plain text", () => {
    expect(placeholdersIn("no tokens here")).toEqual([]);
  });

  it("ignores malformed braces", () => {
    expect(placeholdersIn("{ spaced } {kebab-case} {ok}")).toEqual(["ok"]);
  });
});
