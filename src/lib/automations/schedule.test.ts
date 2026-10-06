import { describe, expect, it } from "vitest";
import {
  describeCronLocally,
  formatLocalTime,
  isReportDue,
  localMoment,
  safeLocalMoment,
} from "./schedule";

// The dispatcher wakes every five minutes. Everything that decides whether a
// report goes out — and whether it goes out TWELVE times — is in here, so this
// is where the test effort belongs.

describe("localMoment", () => {
  it("converts a UTC instant to wall-clock parts in the target zone", () => {
    // 2026-03-10T15:00:00Z — Dubai is UTC+4 year round.
    const m = localMoment(new Date("2026-03-10T15:00:00Z"), "Asia/Dubai");
    expect(m.date).toBe("2026-03-10");
    expect(m.hour).toBe(19);
    expect(m.minute).toBe(0);
    expect(m.minutesOfDay).toBe(19 * 60);
    expect(m.weekday).toBe("Tue");
  });

  it("rolls the local DATE forward when the zone is ahead of UTC", () => {
    // 22:30 UTC is already the next day in Dubai. If the date didn't roll, the
    // double-send guard would compare against the wrong day.
    const m = localMoment(new Date("2026-03-10T22:30:00Z"), "Asia/Dubai");
    expect(m.date).toBe("2026-03-11");
    expect(m.hour).toBe(2);
    expect(m.weekday).toBe("Wed");
  });

  it("rolls the local date BACKWARD when the zone is behind UTC", () => {
    // Toronto is on EDT (UTC-4) by 2026-03-10 — DST began on the 8th — so
    // 03:00Z is 23:00 the previous evening, not 22:00.
    const m = localMoment(new Date("2026-03-10T03:00:00Z"), "America/Toronto");
    expect(m.date).toBe("2026-03-09");
    expect(m.hour).toBe(23);
  });

  it("reports midnight as hour 0, not 24", () => {
    const m = localMoment(new Date("2026-03-10T20:00:00Z"), "Asia/Dubai");
    expect(m.hour).toBe(0);
    expect(m.minutesOfDay).toBe(0);
    expect(m.date).toBe("2026-03-11");
  });

  it("honours a DST transition rather than a fixed offset", () => {
    // Toronto springs forward 2026-03-08. These two instants are 24h apart but
    // land on the same wall-clock hour — only a real tz database gets this
    // right, which is the reason this module uses Intl.
    const before = localMoment(
      new Date("2026-03-07T17:00:00Z"),
      "America/Toronto",
    );
    const after = localMoment(
      new Date("2026-03-09T16:00:00Z"),
      "America/Toronto",
    );
    expect(before.hour).toBe(12);
    expect(after.hour).toBe(12);
  });

  it("safeLocalMoment falls back to UTC for a bogus zone instead of throwing", () => {
    const at = new Date("2026-03-10T15:00:00Z");
    expect(() => localMoment(at, "Not/AZone")).toThrow();
    expect(safeLocalMoment(at, "Not/AZone").hour).toBe(15);
  });
});

describe("isReportDue", () => {
  const at = (date: string, zone = "Asia/Dubai") =>
    localMoment(new Date(date), zone);

  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const base = { hour: 19, minute: 0, weekdays, enabled: true, lastRunOn: null };

  it("fires at the scheduled minute", () => {
    // 15:00Z = 19:00 Dubai, a Tuesday.
    expect(isReportDue(base, at("2026-03-10T15:00:00Z"))).toEqual({
      due: true,
      forDate: "2026-03-10",
    });
  });

  it("fires on a later tick the same day — the dispatcher's granularity", () => {
    // 19:04 local. An exact-equality check would miss this forever.
    expect(isReportDue(base, at("2026-03-10T15:04:00Z")).due).toBe(true);
  });

  it("does not fire before the scheduled time", () => {
    expect(isReportDue(base, at("2026-03-10T14:55:00Z"))).toEqual({
      due: false,
      reason: "too-early",
    });
  });

  it("does not fire twice on the same local day", () => {
    const sent = { ...base, lastRunOn: "2026-03-10" };
    expect(isReportDue(sent, at("2026-03-10T15:05:00Z"))).toEqual({
      due: false,
      reason: "already-sent",
    });
    // …and the twelve further ticks that hour are all refused too.
    expect(isReportDue(sent, at("2026-03-10T18:55:00Z")).due).toBe(false);
  });

  it("fires again the NEXT day once the local date has rolled", () => {
    const sent = { ...base, lastRunOn: "2026-03-10" };
    expect(isReportDue(sent, at("2026-03-11T15:00:00Z"))).toEqual({
      due: true,
      forDate: "2026-03-11",
    });
  });

  it("skips a day not in its weekday list", () => {
    // 2026-03-14 is a Saturday.
    expect(isReportDue(base, at("2026-03-14T15:00:00Z"))).toEqual({
      due: false,
      reason: "wrong-day",
    });
  });

  it("respects its own switch", () => {
    expect(
      isReportDue({ ...base, enabled: false }, at("2026-03-10T15:00:00Z")),
    ).toEqual({ due: false, reason: "disabled" });
  });

  it("uses the LOCAL day for the weekday test, not the UTC day", () => {
    // 2026-03-13T21:00Z is Friday in UTC but already Saturday in Dubai, so a
    // weekdays-only report must not fire.
    const m = at("2026-03-13T21:00:00Z");
    expect(m.weekday).toBe("Sat");
    expect(isReportDue(base, m).due).toBe(false);
  });

  it("a report scheduled earlier today sends now rather than waiting a day", () => {
    // Created at 19:30 for 19:00 — documented behaviour, not an accident.
    expect(isReportDue(base, at("2026-03-10T15:30:00Z")).due).toBe(true);
  });
});

describe("describeCronLocally", () => {
  const ref = new Date("2026-03-10T00:00:00Z");

  it("translates a daily UTC cron into local time", () => {
    // monthly-plan-reset really is "0 6 * * *" — 10:00 in Dubai, not 06:00.
    expect(describeCronLocally("0 6 * * *", "Asia/Dubai", ref)).toEqual({
      kind: "daily",
      localTime: "10:00",
    });
    expect(describeCronLocally("30 3 * * *", "Asia/Dubai", ref)).toEqual({
      kind: "daily",
      localTime: "07:30",
    });
  });

  it("calls an every-N-minutes or hourly cron an interval, with no local time", () => {
    expect(describeCronLocally("*/20 * * * *", "Asia/Dubai", ref)).toEqual({
      kind: "interval",
    });
    expect(describeCronLocally("0 * * * *", "Asia/Dubai", ref)).toEqual({
      kind: "interval",
    });
    expect(describeCronLocally("0 */6 * * *", "Asia/Dubai", ref)).toEqual({
      kind: "interval",
    });
  });

  it("returns null for a shape it cannot describe honestly", () => {
    expect(describeCronLocally("0 6 1 * *", "Asia/Dubai", ref)).toBeNull();
    expect(describeCronLocally("0 6 * * MON", "Asia/Dubai", ref)).toBeNull();
    expect(describeCronLocally("nonsense", "Asia/Dubai", ref)).toBeNull();
  });
});

describe("formatLocalTime", () => {
  it("zero-pads both halves", () => {
    expect(formatLocalTime(9, 5)).toBe("09:05");
    expect(formatLocalTime(19, 0)).toBe("19:00");
    expect(formatLocalTime(0, 0)).toBe("00:00");
  });
});
