import { describe, expect, it } from "vitest";
import { parseAddressList } from "./address-list";

describe("parseAddressList", () => {
  it("returns nothing for empty input", () => {
    expect(parseAddressList(null)).toEqual([]);
    expect(parseAddressList(undefined)).toEqual([]);
    expect(parseAddressList("")).toEqual([]);
    expect(parseAddressList("   ")).toEqual([]);
  });

  it("reads a bare address", () => {
    expect(parseAddressList("a@b.com")).toEqual(["a@b.com"]);
  });

  it("reads angle-bracket form with a display name", () => {
    expect(parseAddressList("Jamie Client <jamie@kingsmillfoods.com>")).toEqual([
      "jamie@kingsmillfoods.com",
    ]);
  });

  it("reads several, and lower-cases them", () => {
    expect(
      parseAddressList("A@B.com, Carol <C@D.co.uk>, e@f.org"),
    ).toEqual(["a@b.com", "c@d.co.uk", "e@f.org"]);
  });

  it("is not fooled by a comma inside a quoted display name", () => {
    expect(
      parseAddressList('"Smith, John" <j@x.com>, "Doe, Jane" <jane@y.com>'),
    ).toEqual(["j@x.com", "jane@y.com"]);
  });

  it("de-duplicates, case-insensitively, preserving order", () => {
    expect(parseAddressList("a@b.com, A@B.COM, c@d.com")).toEqual([
      "a@b.com",
      "c@d.com",
    ]);
  });

  it("handles the folded multi-line form a real header arrives in", () => {
    expect(parseAddressList("a@b.com,\r\n\tc@d.com,\r\n e@f.com")).toEqual([
      "a@b.com",
      "c@d.com",
      "e@f.com",
    ]);
  });

  it("skips junk instead of throwing", () => {
    expect(parseAddressList("undisclosed-recipients:;")).toEqual([]);
    expect(parseAddressList("not-an-address, still@valid.com")).toEqual([
      "still@valid.com",
    ]);
  });

  it("strips trailing punctuation that isn't part of the address", () => {
    expect(parseAddressList("<a@b.com>; <c@d.com>;")).toEqual([
      "a@b.com",
      "c@d.com",
    ]);
  });
});
