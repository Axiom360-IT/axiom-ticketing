import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import { DESCRIBED_SEND_FAILURES } from "./send-failure-causes";

// The UI builds `failure.${code}` at runtime, so the literal-key scanner in
// message-keys.test.ts cannot see these. Without this test, a code with no
// wording renders as "automations.reports.failure.daily_quota_exceeded" to an
// operator — at the exact moment something is already wrong.

describe("send-failure wording", () => {
  const wording = (
    en as unknown as {
      automations: { reports: { failure: Record<string, string> } };
    }
  ).automations.reports.failure;

  it("has a sentence for every described cause", () => {
    const missing = DESCRIBED_SEND_FAILURES.filter(
      (code) => typeof wording[code] !== "string",
    );
    expect(missing).toEqual([]);
  });

  it("has no wording for a cause the UI will never look up", () => {
    // Dead copy is how a list and its translations drift apart in the other
    // direction — the wording looks maintained while nothing can reach it.
    const described = new Set<string>(DESCRIBED_SEND_FAILURES);
    const orphans = Object.keys(wording).filter((k) => !described.has(k));
    expect(orphans).toEqual([]);
  });

  it("explains the quota case in terms of what to do about it", () => {
    // The one that actually happened. It must not just restate the error.
    expect(wording.daily_quota_exceeded.toLowerCase()).toContain("resets");
  });
});
