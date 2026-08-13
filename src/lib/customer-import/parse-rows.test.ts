import { describe, expect, it } from "vitest";
import { parseImportRows } from "./parse-rows";

describe("parseImportRows", () => {
  it("parses plain comma-separated rows", () => {
    expect(
      parseImportRows("Jamie Client, jamie@kingsmillfoods.com, +14165550123"),
    ).toEqual([
      { name: "Jamie Client", email: "jamie@kingsmillfoods.com", phone: "+14165550123" },
    ]);
  });

  it("respects a quoted field containing the delimiter", () => {
    expect(parseImportRows('"Smith, John",john@acme.com')).toEqual([
      { name: "Smith, John", email: "john@acme.com", phone: "" },
    ]);
  });

  it("unescapes a doubled quote inside a quoted field", () => {
    expect(parseImportRows('"Jamie ""JJ"" Client",jamie@acme.com')).toEqual([
      { name: 'Jamie "JJ" Client', email: "jamie@acme.com", phone: "" },
    ]);
  });

  it("uses tab delimiting when any line contains a tab", () => {
    expect(parseImportRows("Smith, John\tjohn@acme.com")).toEqual([
      { name: "Smith, John", email: "john@acme.com", phone: "" },
    ]);
  });

  it("skips a recognized header row", () => {
    expect(parseImportRows("Name, Email, Phone\nAlex Buyer, alex@acme.com")).toEqual([
      { name: "Alex Buyer", email: "alex@acme.com", phone: "" },
    ]);
  });

  it("does not treat an unrecognized first line as a header", () => {
    expect(parseImportRows("Alex Buyer, alex@acme.com")).toEqual([
      { name: "Alex Buyer", email: "alex@acme.com", phone: "" },
    ]);
  });

  it("returns an empty array for blank input", () => {
    expect(parseImportRows("   \n\n  ")).toEqual([]);
  });

  it("defaults phone to empty when the column is omitted", () => {
    expect(parseImportRows("Alex Buyer, alex@acme.com")).toEqual([
      { name: "Alex Buyer", email: "alex@acme.com", phone: "" },
    ]);
  });
});
