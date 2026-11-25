import { describe, expect, it } from "vitest";
import {
  followupClockStart,
  MIN_NOTICE_MS,
  quotedCloseAt,
} from "./followup-clock";

const d = (s: string) => new Date(`${s}Z`);

describe("followupClockStart", () => {
  it("agent spoke last, never parked → the wait counts from the agent's message", () => {
    const at = d("2026-11-19T16:16:00");
    expect(
      followupClockStart({ lastAuthor: "agent", lastAt: at, parkedAt: null }),
    ).toEqual(at);
  });

  it("agent spoke last, parked right after → still the agent's message when parked earlier or equal", () => {
    const at = d("2026-11-19T16:16:00");
    expect(
      followupClockStart({
        lastAuthor: "agent",
        lastAt: at,
        parkedAt: d("2026-11-19T16:15:00"),
      }),
    ).toEqual(at);
  });

  it("agent wrote days ago but parked the ticket only now → counts from the parking, not the old message", () => {
    const parked = d("2026-11-23T09:00:00");
    expect(
      followupClockStart({
        lastAuthor: "agent",
        lastAt: d("2026-11-10T09:00:00"),
        parkedAt: parked,
      }),
    ).toEqual(parked);
  });

  it("customer spoke last and staff parked it afterwards without replying → customer owes; counts from the parking", () => {
    // The 6 stuck tickets of 2026-11-24 (e.g. SJ-20261019-001, YAM-20261110-001).
    const parked = d("2026-11-12T13:24:00");
    expect(
      followupClockStart({
        lastAuthor: "customer",
        lastAt: d("2026-11-10T14:08:00"),
        parkedAt: parked,
      }),
    ).toEqual(parked);
  });

  it("customer spoke last AFTER the parking → they already answered, leave it alone", () => {
    expect(
      followupClockStart({
        lastAuthor: "customer",
        lastAt: d("2026-11-13T08:00:00"),
        parkedAt: d("2026-11-12T13:24:00"),
      }),
    ).toBeNull();
  });

  it("customer spoke last and the ticket was never parked (no stamp) → nothing to count from", () => {
    expect(
      followupClockStart({
        lastAuthor: "customer",
        lastAt: d("2026-11-10T14:08:00"),
        parkedAt: null,
      }),
    ).toBeNull();
  });

  it("no visible message at all → the parking time if there is one, else nothing", () => {
    const parked = d("2026-11-12T13:24:00");
    expect(
      followupClockStart({ lastAuthor: null, lastAt: null, parkedAt: parked }),
    ).toEqual(parked);
    expect(
      followupClockStart({ lastAuthor: null, lastAt: null, parkedAt: null }),
    ).toBeNull();
  });

  it("never treats an unknown author (e.g. system) as the customer owing a reply", () => {
    expect(
      followupClockStart({
        lastAuthor: "system",
        lastAt: d("2026-11-10T14:08:00"),
        parkedAt: d("2026-11-12T13:24:00"),
      }),
    ).toBeNull();
  });
});

describe("quotedCloseAt", () => {
  it("on schedule: clock + followup + close days (1 + 4 = day 5)", () => {
    const clock = d("2026-11-23T10:00:00");
    expect(
      quotedCloseAt(clock, d("2026-11-24T12:00:00"), 1, 4),
    ).toEqual(d("2026-11-28T10:00:00"));
  });

  it("a backlog ticket already past its close date is quoted a day out, never in the past", () => {
    const now = d("2026-11-24T12:00:51");
    expect(
      quotedCloseAt(d("2026-11-12T13:24:00"), now, 1, 4),
    ).toEqual(d("2026-11-25T12:00:51"));
  });
});

describe("MIN_NOTICE_MS", () => {
  it("is shorter than a day so a normal daily series still closes on day 5", () => {
    expect(MIN_NOTICE_MS).toBeLessThan(24 * 60 * 60 * 1000);
    expect(MIN_NOTICE_MS).toBeGreaterThanOrEqual(18 * 60 * 60 * 1000);
  });
});
