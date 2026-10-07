import { describe, expect, it } from "vitest";
import { defaultPolicyFor, occurrenceKey, policiesFor } from "./dedupe";
import type { RuleTrigger } from "./types";

const EVENT: RuleTrigger = { kind: "event", event: "ticket.created" };
const STATE: RuleTrigger = { kind: "state", state: "unassigned_for", minutes: 30 };
const SCHEDULE: RuleTrigger = {
  kind: "schedule",
  hour: 8,
  minute: 0,
  weekdays: ["Mon"],
};

const NOW = new Date("2026-10-07T14:32:45.000Z");

describe("occurrenceKey", () => {
  it("returns no key for 'always', so nothing is written", () => {
    // A ledger row per firing would grow without ever being read.
    expect(
      occurrenceKey({ dedupe: { policy: "always" }, trigger: EVENT, now: NOW }),
    ).toBeNull();
  });

  it("collapses once_per_ticket to a single stable key", () => {
    const key = () =>
      occurrenceKey({
        dedupe: { policy: "once_per_ticket" },
        trigger: EVENT,
        now: new Date(),
      });
    expect(key()).toBe("once");
    expect(key()).toBe("once");
  });

  describe("once_per_occurrence", () => {
    it("keys an event rule on the change that caused it", () => {
      const a = occurrenceKey({
        dedupe: { policy: "once_per_occurrence" },
        trigger: EVENT,
        now: NOW,
        changeEventId: "chg-1",
      });
      const b = occurrenceKey({
        dedupe: { policy: "once_per_occurrence" },
        trigger: EVENT,
        now: NOW,
        changeEventId: "chg-2",
      });
      expect(a).toBe("event:chg-1");
      expect(b).not.toBe(a);
    });

    it("falls back to the instant when there is no change id", () => {
      // A preview or a replay. The worst case has to be a duplicate rather
      // than a silent drop.
      const key = occurrenceKey({
        dedupe: { policy: "once_per_occurrence" },
        trigger: EVENT,
        now: NOW,
      });
      expect(key).toBe(`event:${NOW.toISOString()}`);
    });

    it("keys a state rule on when the waiting began", () => {
      const started = new Date("2026-10-07T09:00:00.000Z");
      const first = occurrenceKey({
        dedupe: { policy: "once_per_occurrence" },
        trigger: STATE,
        now: NOW,
        stateStartedAt: started,
      });
      // The scanner wakes again ten minutes later. Same episode, same key,
      // so the ticket is not alerted on twice.
      const second = occurrenceKey({
        dedupe: { policy: "once_per_occurrence" },
        trigger: STATE,
        now: new Date(NOW.getTime() + 600_000),
        stateStartedAt: started,
      });
      expect(second).toBe(first);
    });

    it("treats a ticket abandoned AGAIN as a new occurrence", () => {
      // Assigned, then unassigned: the waiting restarted, so the operator
      // should hear about it again. A per-ticket key would never fire twice.
      const first = occurrenceKey({
        dedupe: { policy: "once_per_occurrence" },
        trigger: STATE,
        now: NOW,
        stateStartedAt: new Date("2026-10-07T09:00:00.000Z"),
      });
      const second = occurrenceKey({
        dedupe: { policy: "once_per_occurrence" },
        trigger: STATE,
        now: NOW,
        stateStartedAt: new Date("2026-10-07T13:00:00.000Z"),
      });
      expect(second).not.toBe(first);
    });

    it("ignores sub-minute jitter in a state episode", () => {
      // An `updated_at` touch must not look like a fresh episode.
      const a = occurrenceKey({
        dedupe: { policy: "once_per_occurrence" },
        trigger: STATE,
        now: NOW,
        stateStartedAt: new Date("2026-10-07T09:00:10.000Z"),
      });
      const b = occurrenceKey({
        dedupe: { policy: "once_per_occurrence" },
        trigger: STATE,
        now: NOW,
        stateStartedAt: new Date("2026-10-07T09:00:50.000Z"),
      });
      expect(b).toBe(a);
    });

    it("keys a schedule rule on the local date", () => {
      expect(
        occurrenceKey({
          dedupe: { policy: "once_per_occurrence" },
          trigger: SCHEDULE,
          now: NOW,
          localDate: "2026-10-07",
        }),
      ).toBe("date:2026-10-07");
    });
  });

  describe("throttle", () => {
    it("holds one key for the whole window, then moves on", () => {
      const at = (iso: string) =>
        occurrenceKey({
          dedupe: { policy: "throttle", throttleMinutes: 60 },
          trigger: EVENT,
          now: new Date(iso),
        });
      expect(at("2026-10-07T14:05:00Z")).toBe(at("2026-10-07T14:55:00Z"));
      expect(at("2026-10-07T15:05:00Z")).not.toBe(at("2026-10-07T14:55:00Z"));
    });

    it("falls back to the STRICTEST policy when the interval is missing", () => {
      // A throttle with no interval is a misconfiguration. Falling back to
      // "always" would turn a broken rule into a flood; "once" cannot.
      for (const bad of [undefined, 0, -5]) {
        expect(
          occurrenceKey({
            dedupe: { policy: "throttle", throttleMinutes: bad as number },
            trigger: EVENT,
            now: NOW,
          }),
        ).toBe("once");
      }
    });
  });
});

describe("policiesFor", () => {
  it("never offers 'always' on a state rule", () => {
    // It would re-fire on every scan pass: six alerts an hour, forever.
    expect(policiesFor("state")).not.toContain("always");
  });

  it("offers every policy on a schedule rule", () => {
    // It evaluates each open ticket when its time comes, so it HAS a ticket
    // in hand — unlike a scheduled report, which is a digest.
    expect(policiesFor("schedule")).toHaveLength(4);
  });

  it("offers everything on an event rule", () => {
    expect(policiesFor("event")).toHaveLength(4);
  });

  it("always offers at least one policy, and its default is among them", () => {
    for (const kind of ["event", "state", "schedule"] as const) {
      const offered = policiesFor(kind);
      expect(offered.length).toBeGreaterThan(0);
      expect(offered).toContain(defaultPolicyFor());
    }
  });
});
