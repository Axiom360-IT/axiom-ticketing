import { beforeAll, describe, expect, it } from "vitest";
import {
  signCsatToken,
  signGuestToken,
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
  it("roundtrips satisfied", () => {
    const t = signCsatToken("AX-0042", "satisfied");
    expect(verifyCsatToken(t, "AX-0042")).toBe("satisfied");
  });

  it("roundtrips unsatisfied", () => {
    const t = signCsatToken("AX-0042", "unsatisfied");
    expect(verifyCsatToken(t, "AX-0042")).toBe("unsatisfied");
  });

  it("rejects with wrong ticket", () => {
    const t = signCsatToken("AX-0042", "satisfied");
    expect(verifyCsatToken(t, "AX-0099")).toBeNull();
  });

  it("rejects a tampered response", () => {
    const t = signCsatToken("AX-0042", "satisfied");
    const buf = Buffer.from(t, "base64url");
    buf[buf.length - 1] ^= 0xff;
    expect(verifyCsatToken(buf.toString("base64url"), "AX-0042")).toBeNull();
  });
});
