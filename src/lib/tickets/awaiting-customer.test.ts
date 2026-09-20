import { describe, expect, it } from "vitest";
import { resumeFromAwaitingCustomer } from "./awaiting-customer";

const NOW = new Date("2026-09-20T12:00:00.000Z");
const PAUSED_AT = new Date("2026-09-20T10:00:00.000Z"); // 2h paused

function parked(over: Partial<Parameters<typeof resumeFromAwaitingCustomer>[0]> = {}) {
  return {
    status: "awaiting_customer_confirmation",
    assignedToId: null as string | null,
    slaPausedAt: PAUSED_AT,
    responseDueAt: new Date("2026-09-20T09:00:00.000Z"),
    resolutionDueAt: new Date("2026-09-21T09:00:00.000Z"),
    ...over,
  };
}

describe("resumeFromAwaitingCustomer", () => {
  it("leaves any other status untouched", () => {
    for (const status of ["open", "in_progress", "on_hold", "resolved", "closed"]) {
      expect(resumeFromAwaitingCustomer(parked({ status }), NOW)).toBeNull();
    }
  });

  it("hands an unassigned ticket back as open", () => {
    expect(resumeFromAwaitingCustomer(parked(), NOW)?.status).toBe("open");
  });

  it("hands an assigned ticket back to its assignee as in_progress", () => {
    expect(
      resumeFromAwaitingCustomer(parked({ assignedToId: "u1" }), NOW)?.status,
    ).toBe("in_progress");
  });

  it("clears the reminder series so the next parking starts fresh", () => {
    const patch = resumeFromAwaitingCustomer(parked(), NOW);
    expect(patch?.customerFollowupSentAt).toBeNull();
    expect(patch?.customerFollowupCount).toBe(0);
  });

  it("resumes the SLA clock by shifting due dates forward by the paused span", () => {
    const patch = resumeFromAwaitingCustomer(parked(), NOW);
    expect(patch?.slaPausedAt).toBeNull();
    // Paused 2h → both due dates move 2h later.
    expect((patch?.responseDueAt as Date).toISOString()).toBe(
      "2026-09-20T11:00:00.000Z",
    );
    expect((patch?.resolutionDueAt as Date).toISOString()).toBe(
      "2026-09-21T11:00:00.000Z",
    );
  });

  it("still unparks when the pause marker is missing (no due-date shift)", () => {
    const patch = resumeFromAwaitingCustomer(parked({ slaPausedAt: null }), NOW);
    expect(patch?.status).toBe("open");
    expect(patch?.slaPausedAt).toBeNull();
    expect(patch?.responseDueAt).toBeUndefined();
    expect(patch?.resolutionDueAt).toBeUndefined();
  });
});
