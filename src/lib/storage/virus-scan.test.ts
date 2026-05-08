import { describe, expect, it } from "vitest";
import { looksLikeEicar, parseClamavRestResponse } from "./virus-scan-core";

// Build the EICAR test buffer the way the spec calls for it. Split into
// halves so this test file itself doesn't trigger AV scanners.
function eicarBuffer(): Uint8Array {
  const a = "X5O!P%@AP[4\\PZX54(P^)7CC)7}";
  const b = "$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
  return Buffer.from(`${a}${b}`, "latin1");
}

describe("looksLikeEicar", () => {
  it("flags the canonical EICAR test signature", () => {
    expect(looksLikeEicar(eicarBuffer())).toBe(true);
  });

  it("flags EICAR even when surrounded by other bytes", () => {
    const padded = Buffer.concat([
      Buffer.from("preamble\n", "latin1"),
      eicarBuffer(),
      Buffer.from("\ntrailer", "latin1"),
    ]);
    expect(looksLikeEicar(padded)).toBe(true);
  });

  it("does not flag clean ASCII text", () => {
    const buf = Buffer.from("hello, world — this is a perfectly normal file", "utf8");
    expect(looksLikeEicar(buf)).toBe(false);
  });

  it("does not flag binary noise", () => {
    const buf = new Uint8Array(1024);
    for (let i = 0; i < buf.length; i++) buf[i] = (i * 31 + 7) & 0xff;
    expect(looksLikeEicar(buf)).toBe(false);
  });
});

describe("parseClamavRestResponse", () => {
  it("treats clamav-rest-api success/clean as clean", () => {
    const r = parseClamavRestResponse({
      success: true,
      data: {
        result: [{ name: "x", is_infected: false, viruses: [] }],
      },
    });
    expect(r.result).toBe("clean");
  });

  it("returns infected with virus names when is_infected=true", () => {
    const r = parseClamavRestResponse({
      success: true,
      data: {
        result: [
          { name: "x", is_infected: true, viruses: ["Eicar-Signature"] },
        ],
      },
    });
    expect(r).toEqual({ result: "infected", signature: "Eicar-Signature" });
  });

  it("supports the flat fallback shape", () => {
    expect(
      parseClamavRestResponse({ is_infected: true, signature: "Trojan.X" }),
    ).toEqual({ result: "infected", signature: "Trojan.X" });
    expect(parseClamavRestResponse({ is_infected: false })).toEqual({
      result: "clean",
    });
  });

  it("returns error on unrecognised shape", () => {
    expect(parseClamavRestResponse(null).result).toBe("error");
    expect(parseClamavRestResponse({}).result).toBe("error");
    expect(parseClamavRestResponse({ random: "field" }).result).toBe("error");
  });
});
