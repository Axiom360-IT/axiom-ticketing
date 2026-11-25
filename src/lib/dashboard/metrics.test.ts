import { describe, expect, it } from "vitest";
import {
  AGE_BUCKETS,
  ageSlices,
  fillTrend,
  minutesToHours,
  ratio,
  round1,
  secondsToHours,
  toPercent,
  topWithOther,
  trailingDays,
  trailingMonths,
} from "./metrics";

describe("trailingDays", () => {
  it("lists the last N UTC days, oldest first, ending today", () => {
    expect(trailingDays(3, new Date("2026-11-25T08:30:00Z"))).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
    ]);
  });

  it("uses the UTC day, not the local one, near midnight", () => {
    expect(trailingDays(1, new Date("2026-11-25T23:59:59Z"))).toEqual(["2026-11-25"]);
    expect(trailingDays(1, new Date("2026-11-26T00:00:01Z"))).toEqual(["2026-11-26"]);
  });

  it("crosses month and year ends", () => {
    expect(trailingDays(3, new Date("2027-01-01T10:00:00Z"))).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
    ]);
  });

  it("returns exactly N days", () => {
    expect(trailingDays(30, new Date("2026-11-25T00:00:00Z"))).toHaveLength(30);
  });
});

describe("trailingMonths", () => {
  it("lists the last N months, oldest first, across a year end", () => {
    expect(trailingMonths(3, new Date("2027-01-15T10:00:00Z"))).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
  it("includes the current month last, even on the 31st", () => {
    expect(trailingMonths(2, new Date("2026-03-31T23:00:00Z"))).toEqual(["2026-02", "2026-03"]);
  });
});

describe("fillTrend", () => {
  const days = ["2026-11-23", "2026-11-24", "2026-11-25"];

  it("leaves a day with no data as null (a gap), not zero", () => {
    const rows = fillTrend(days, { avg: new Map([["2026-11-24", 2.5]]) });
    expect(rows).toEqual([
      { date: "2026-11-23", avg: null },
      { date: "2026-11-24", avg: 2.5 },
      { date: "2026-11-25", avg: null },
    ]);
  });

  it("fills with zero when asked (counts, where nothing happened really is zero)", () => {
    const rows = fillTrend(days, { n: new Map([["2026-11-25", 4]]) }, { zeroFill: true });
    expect(rows.map((r) => r.n)).toEqual([0, 0, 4]);
  });

  it("keeps a real zero as zero even when gaps are null", () => {
    const rows = fillTrend(days, { n: new Map([["2026-11-23", 0]]) });
    expect(rows[0].n).toBe(0);
    expect(rows[1].n).toBeNull();
  });

  it("handles several series on the same days", () => {
    const rows = fillTrend(days, {
      created: new Map([["2026-11-23", 3]]),
      resolved: new Map([["2026-11-25", 1]]),
    });
    expect(rows[0]).toEqual({ date: "2026-11-23", created: 3, resolved: null });
    expect(rows[2]).toEqual({ date: "2026-11-25", created: null, resolved: 1 });
  });
});

describe("topWithOther", () => {
  const s = (key: string, value: number) => ({ key, name: key.toUpperCase(), value });

  it("returns everything, largest first, when it fits", () => {
    expect(topWithOther([s("a", 1), s("b", 5)], 3, "Other").map((x) => x.key)).toEqual(["b", "a"]);
  });

  it("folds the smallest into one Other slice and keeps the total", () => {
    const input = [s("a", 10), s("b", 8), s("c", 3), s("d", 2), s("e", 1)];
    const out = topWithOther(input, 2, "Everyone else");
    expect(out.map((x) => x.key)).toEqual(["a", "b", "other"]);
    expect(out[2]).toEqual({ key: "other", name: "Everyone else", value: 6 });
    expect(out.reduce((t, x) => t + x.value, 0)).toBe(24);
  });

  it("puts Other last even when it is the biggest", () => {
    const out = topWithOther([s("a", 5), s("b", 4), s("c", 4), s("d", 4)], 1, "Other");
    expect(out.map((x) => x.key)).toEqual(["a", "other"]);
    expect(out[1].value).toBe(12);
  });

  it("does not mutate its input", () => {
    const input = [s("a", 1), s("b", 9)];
    topWithOther(input, 1, "Other");
    expect(input.map((x) => x.key)).toEqual(["a", "b"]);
  });

  it("never folds away a slice it was told to keep, however small", () => {
    const input = [s("a", 10), s("b", 8), s("c", 7), s("unassigned", 1)];
    const out = topWithOther(input, 2, "Other", ["unassigned"]);
    // limit 2 = the kept slice + the single largest other; the rest folds
    expect(out.map((x) => x.key)).toEqual(["a", "unassigned", "other"]);
    expect(out.at(-1)!.value).toBe(15);
    expect(out.reduce((t, x) => t + x.value, 0)).toBe(26);
  });

  it("keeps a kept slice even when it alone fills the limit", () => {
    const out = topWithOther([s("u", 1), s("a", 9)], 1, "Other", ["u"]);
    expect(out.map((x) => x.key)).toEqual(["u", "other"]);
  });

  it("adds no Other slice when nothing is folded (exact fit)", () => {
    expect(topWithOther([s("a", 1), s("b", 2)], 2, "Other")).toHaveLength(2);
  });
});

describe("ratio and conversions", () => {
  it("is null with nothing to measure, never a misleading 0% or NaN", () => {
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(3, 0)).toBeNull();
    expect(ratio(0, 5)).toBe(0);
  });

  it("stays within 0..1", () => {
    expect(ratio(7, 4)).toBe(1);
    expect(ratio(-1, 4)).toBe(0);
    expect(ratio(1, 4)).toBe(0.25);
  });

  it("rounds to one decimal", () => {
    expect(round1(2.349)).toBe(2.3);
    expect(round1(2.35)).toBe(2.4);
    expect(minutesToHours(90)).toBe(1.5);
    expect(minutesToHours(100)).toBe(1.7);
  });

  it("keeps 'no data' as null when converting", () => {
    expect(secondsToHours(null)).toBeNull();
    expect(secondsToHours(undefined)).toBeNull();
    expect(secondsToHours(Number.NaN)).toBeNull();
    expect(secondsToHours(5400)).toBe(1.5);
    expect(secondsToHours(0)).toBe(0);
    expect(toPercent(null)).toBeNull();
    expect(toPercent(0.876)).toBe(88);
  });
});

describe("ageSlices", () => {
  const names = {
    d0_1: "Under a day",
    d1_3: "1-3 days",
    d3_7: "3-7 days",
    d7_14: "1-2 weeks",
    d14_plus: "2+ weeks",
  };

  it("returns every bucket in order, with zeros kept", () => {
    const out = ageSlices({ d0_1: 4, d3_7: 2 }, names);
    expect(out.map((s) => s.key)).toEqual([...AGE_BUCKETS]);
    expect(out.map((s) => s.value)).toEqual([4, 0, 2, 0, 0]);
    expect(out[0].name).toBe("Under a day");
  });
});
