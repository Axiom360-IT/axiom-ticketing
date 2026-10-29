import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";

// The warning builds two of its keys dynamically — `status.${issue.status}` and
// `outcome.${outcome}` — which the literal-key scanner in message-keys.test.ts
// cannot see. A status or outcome with no wording would render as a key path in
// the one place whose job is explaining what is wrong.

const t = (en as unknown as { emailDelivery: Record<string, unknown> }).emailDelivery;

describe("email delivery wording", () => {
  it("explains every status a flagged address can have", () => {
    const status = t.status as Record<string, string>;
    for (const s of ["suppressed", "bounced", "complained"]) {
      expect(status[s], s).toBeTruthy();
    }
  });

  it("has a message for every possible result of a test email", () => {
    const outcome = t.outcome as Record<string, string>;
    for (const o of ["delivered", "blocked", "pending"]) {
      expect(outcome[o], o).toBeTruthy();
    }
  });

  it("gives all four fix steps, in order, and the Resend link text", () => {
    for (const k of ["step1", "step2", "step3", "step4", "openResend"]) {
      expect(typeof t[k], k).toBe("string");
    }
  });

  it("names the thing to click exactly as Resend labels it", () => {
    // Step 2 sends someone to a button in another product. If it is misquoted
    // they will not find it.
    expect(t.step2).toContain("Remove from suppression list");
  });
});
