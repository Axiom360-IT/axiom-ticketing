import { describe, expect, it } from "vitest";
import { computeDueAt, toIsoDate, type BusinessHoursConfig } from "./sla-compute";

const TORONTO: BusinessHoursConfig = {
  timezone: "America/Toronto",
  startHour: 9,
  endHour: 18,
  workingDays: new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]),
  holidays: new Set(),
};

const UTC_24_7: BusinessHoursConfig = {
  timezone: "UTC",
  startHour: 0,
  endHour: 24,
  workingDays: new Set(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]),
  holidays: new Set(),
};

describe("computeDueAt — non-business-hours (criticals path)", () => {
  it("adds wall-clock minutes when respectBusinessHours = false", () => {
    const t = new Date("2026-03-04T18:30:00Z"); // any UTC time
    const out = computeDueAt(t, 90, false, TORONTO);
    expect(out.toISOString()).toBe("2026-03-04T20:00:00.000Z");
  });
});

describe("computeDueAt — business-hours basics", () => {
  it("a 30-minute SLA created at 10:00 Toronto Mon → due 10:30 the same day", () => {
    // Toronto on 2026-03-09 is EDT (UTC-04:00) — let's pick a date
    // outside DST first to keep the offset stable: 2026-02-09 (Mon, EST UTC-05:00).
    // 10:00 EST = 15:00 UTC.
    const created = new Date("2026-02-09T15:00:00Z");
    const out = computeDueAt(created, 30, true, TORONTO);
    // 10:30 EST = 15:30 UTC.
    expect(out.toISOString()).toBe("2026-02-09T15:30:00.000Z");
  });

  it("rolls over a single day when SLA exceeds remaining hours", () => {
    // 17:00 EST + 90 minutes business = 9:30 next morning.
    // 17:00 EST = 22:00 UTC; next 9:30 EST = 14:30 UTC the next day.
    const created = new Date("2026-02-09T22:00:00Z"); // Mon
    const out = computeDueAt(created, 90, true, TORONTO);
    expect(out.toISOString()).toBe("2026-02-10T14:30:00.000Z"); // Tue 9:30 EST
  });

  it("clamps a Saturday-created SLA forward to Monday 9:00", () => {
    // Sat 2026-02-07 14:00 UTC = 09:00 EST — but Saturday isn't a working day.
    const created = new Date("2026-02-07T14:00:00Z");
    const out = computeDueAt(created, 60, true, TORONTO);
    // First 60 minutes of Mon = 9:00–10:00 EST → 10:00 EST = 15:00 UTC.
    expect(out.toISOString()).toBe("2026-02-09T15:00:00.000Z");
  });

  it("clamps an after-hours weekday SLA forward to next 9:00", () => {
    const created = new Date("2026-02-09T23:30:00Z"); // 18:30 EST Mon
    const out = computeDueAt(created, 60, true, TORONTO);
    // Tue 10:00 EST = 15:00 UTC.
    expect(out.toISOString()).toBe("2026-02-10T15:00:00.000Z");
  });

  it("clamps a before-hours weekday SLA forward to 9:00 same day", () => {
    const created = new Date("2026-02-09T11:00:00Z"); // 06:00 EST Mon
    const out = computeDueAt(created, 60, true, TORONTO);
    // Mon 10:00 EST = 15:00 UTC.
    expect(out.toISOString()).toBe("2026-02-09T15:00:00.000Z");
  });

  it("skips holidays even on a working weekday", () => {
    const cfg: BusinessHoursConfig = {
      ...TORONTO,
      holidays: new Set(["2026-02-09"]), // Mon holiday
    };
    const created = new Date("2026-02-09T15:00:00Z"); // Mon 10:00 EST → holiday
    const out = computeDueAt(created, 60, true, cfg);
    // Skip to Tue 10:00 EST = 15:00 UTC.
    expect(out.toISOString()).toBe("2026-02-10T15:00:00.000Z");
  });

  it("crosses a weekend cleanly", () => {
    // Fri 2026-02-13 17:00 EST + 120 min business = Mon 10:00 EST.
    const created = new Date("2026-02-13T22:00:00Z");
    const out = computeDueAt(created, 120, true, TORONTO);
    // Mon 10:00 EST = 15:00 UTC.
    expect(out.toISOString()).toBe("2026-02-16T15:00:00.000Z");
  });
});

describe("computeDueAt — DST transitions", () => {
  it("handles spring-forward without dropping or adding an hour", () => {
    // EDT begins 2026-03-08 (Sun). Friday 2026-03-06 is still EST.
    // Created Fri 16:00 EST = 21:00 UTC; +180 business min = Mon 10:00 EDT.
    // Mon 10:00 EDT = 14:00 UTC.
    const created = new Date("2026-03-06T21:00:00Z");
    const out = computeDueAt(created, 180, true, TORONTO);
    expect(out.toISOString()).toBe("2026-03-09T14:00:00.000Z");
  });

  it("handles fall-back without adding an hour", () => {
    // EDT ends 2026-11-01. Fri 2026-10-30 is EDT.
    // Created Fri 16:00 EDT = 20:00 UTC; +180 business min = Mon 10:00 EST.
    // Mon 10:00 EST = 15:00 UTC.
    const created = new Date("2026-10-30T20:00:00Z");
    const out = computeDueAt(created, 180, true, TORONTO);
    expect(out.toISOString()).toBe("2026-11-02T15:00:00.000Z");
  });
});

describe("computeDueAt — UTC 24/7 config (sanity)", () => {
  it("matches non-business-hours computation when every hour is working", () => {
    const created = new Date("2026-03-04T18:30:00Z");
    const naive = new Date(created.getTime() + 90 * 60_000);
    const businessHours = computeDueAt(created, 90, true, UTC_24_7);
    expect(businessHours.toISOString()).toBe(naive.toISOString());
  });
});

describe("toIsoDate", () => {
  it("formats a UTC Date as the YYYY-MM-DD seen in tz", () => {
    // 2026-02-09T03:00:00Z is 2026-02-08 22:00 EST.
    const d = new Date("2026-02-09T03:00:00Z");
    expect(toIsoDate(d, "America/Toronto")).toBe("2026-02-08");
  });
  it("respects UTC", () => {
    expect(toIsoDate(new Date("2026-02-09T03:00:00Z"), "UTC")).toBe(
      "2026-02-09",
    );
  });
});
