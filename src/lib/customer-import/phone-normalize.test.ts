import { describe, expect, it } from "vitest";
import { normalizeImportPhone } from "./phone-normalize";

describe("normalizeImportPhone", () => {
  it("normalizes a US local-format number to E.164", () => {
    expect(normalizeImportPhone("415-555-2671", "US")).toEqual({
      ok: true,
      e164: "+14155552671",
    });
  });

  it("normalizes a number that already includes a country code", () => {
    expect(normalizeImportPhone("+14155552671", "US")).toEqual({
      ok: true,
      e164: "+14155552671",
    });
  });

  it("resolves an ambiguous local number against the given default country", () => {
    expect(normalizeImportPhone("416-555-0123", "CA")).toEqual({
      ok: true,
      e164: "+14165550123",
    });
  });

  it("returns ok:false for unparseable input instead of throwing", () => {
    expect(normalizeImportPhone("not a phone", "US")).toEqual({ ok: false });
  });

  it("returns ok:false for empty/whitespace input", () => {
    expect(normalizeImportPhone("", "US")).toEqual({ ok: false });
    expect(normalizeImportPhone("   ", "US")).toEqual({ ok: false });
  });
});
