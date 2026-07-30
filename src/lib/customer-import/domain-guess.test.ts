import { describe, expect, it } from "vitest";
import { guessOrgNameFromDomain, isFreeMailDomain } from "./domain-guess";

describe("isFreeMailDomain", () => {
  it("flags common personal providers", () => {
    expect(isFreeMailDomain("gmail.com")).toBe(true);
    expect(isFreeMailDomain("outlook.com")).toBe(true);
    expect(isFreeMailDomain("ICLOUD.COM")).toBe(true);
  });

  it("does not flag a corporate domain", () => {
    expect(isFreeMailDomain("kingsmillfoods.com")).toBe(false);
  });
});

describe("guessOrgNameFromDomain", () => {
  it("title-cases a single-word domain", () => {
    expect(guessOrgNameFromDomain("kingsmillfoods.com")).toBe("Kingsmillfoods");
  });

  it("splits on hyphens into separate words", () => {
    expect(guessOrgNameFromDomain("king-mill-foods.com")).toBe(
      "King Mill Foods",
    );
  });

  it("splits a dotted subdomain-style name into separate words", () => {
    expect(guessOrgNameFromDomain("acadian-group.ca")).toBe("Acadian Group");
  });

  it("falls back to the raw domain when nothing is left after stripping", () => {
    expect(guessOrgNameFromDomain(".com")).toBe(".com");
  });
});
