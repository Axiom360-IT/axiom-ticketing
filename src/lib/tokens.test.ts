import { beforeAll, describe, expect, it } from "vitest";
import {
  signCsatAccessToken,
  signCsatToken,
  signGuestToken,
  verifyCsatAccessToken,
  verifyCsatToken,
  verifyGuestToken,
} from "./tokens";

const TEST_GUEST = "guest-test-secret-32-chars-min-AAAA";
const TEST_CSAT = "csat-test-secret-32-chars-min-BBBBB";

beforeAll(() => {
  process.env.GUEST_TOKEN_SECRET = TEST_GUEST;
  process.env.CSAT_TOKEN_SECRET = TEST_CSAT;
});

describe("signGuestToken / verifyGuestToken", () => {
  it("roundtrips successfully", () => {
    const t = signGuestToken("AX-0042", "alice@example.com");
    expect(verifyGuestToken(t, "AX-0042")).toBe("alice@example.com");
  });

  it("rejects with wrong ticket number", () => {
    const t = signGuestToken("AX-0042", "alice@example.com");
    expect(verifyGuestToken(t, "AX-0043")).toBeNull();
  });

  it("rejects a tampered token", () => {
    const t = signGuestToken("AX-0042", "alice@example.com");
    const buf = Buffer.from(t, "base64url");
    buf[buf.length - 1] ^= 0xff;
    expect(
      verifyGuestToken(buf.toString("base64url"), "AX-0042"),
    ).toBeNull();
  });

  it("rejects garbage input", () => {
    expect(verifyGuestToken("not-a-token", "AX-0042")).toBeNull();
    expect(verifyGuestToken("", "AX-0042")).toBeNull();
  });

  it("emails with special chars work", () => {
    const email = "first.last+tag@sub.example.co.uk";
    const t = signGuestToken("AX-9999", email);
    expect(verifyGuestToken(t, "AX-9999")).toBe(email);
  });
});

describe("signCsatToken / verifyCsatToken", () => {
  it("roundtrips each emoji rating", () => {
    for (const r of ["happy", "neutral", "unhappy"] as const) {
      const t = signCsatToken("AX-0042", r);
      expect(verifyCsatToken(t, "AX-0042")).toBe(r);
    }
  });

  it("maps legacy binary tokens (satisfied→happy, unsatisfied→unhappy)", () => {
    // @ts-expect-error — legacy value, minted before the emoji upgrade.
    const sat = signCsatToken("AX-0042", "satisfied");
    expect(verifyCsatToken(sat, "AX-0042")).toBe("happy");
    // @ts-expect-error — legacy value.
    const unsat = signCsatToken("AX-0042", "unsatisfied");
    expect(verifyCsatToken(unsat, "AX-0042")).toBe("unhappy");
  });

  it("rejects with wrong ticket", () => {
    const t = signCsatToken("AX-0042", "happy");
    expect(verifyCsatToken(t, "AX-0099")).toBeNull();
  });

  it("rejects a tampered rating", () => {
    const t = signCsatToken("AX-0042", "happy");
    const buf = Buffer.from(t, "base64url");
    buf[buf.length - 1] ^= 0xff;
    expect(verifyCsatToken(buf.toString("base64url"), "AX-0042")).toBeNull();
  });
});

describe("signCsatAccessToken / verifyCsatAccessToken", () => {
  it("roundtrips for the same ticket", () => {
    const t = signCsatAccessToken("AX-0042");
    expect(verifyCsatAccessToken(t, "AX-0042")).toBe(true);
  });

  it("rejects for a different ticket", () => {
    const t = signCsatAccessToken("AX-0042");
    expect(verifyCsatAccessToken(t, "AX-0099")).toBe(false);
  });

  it("rejects a tampered token", () => {
    const t = signCsatAccessToken("AX-0042");
    const buf = Buffer.from(t, "base64url");
    buf[buf.length - 1] ^= 0xff;
    expect(verifyCsatAccessToken(buf.toString("base64url"), "AX-0042")).toBe(
      false,
    );
  });

  it("is not accepted by the rating-bound verifier and vice-versa", () => {
    const access = signCsatAccessToken("AX-0042");
    expect(verifyCsatToken(access, "AX-0042")).toBeNull();
    const rated = signCsatToken("AX-0042", "happy");
    expect(verifyCsatAccessToken(rated, "AX-0042")).toBe(false);
  });
});
