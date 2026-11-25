import type { Slice, TrendRow } from "./chart-spec";

// ── Shaping dashboard metrics ─────────────────────────────────────────────
//
// The queries (queries.ts) return raw rows; everything about turning them into
// something a chart can draw lives here, as pure functions, so the rules that are
// easy to get subtly wrong — gaps vs zeros, "top N plus the rest", rounding —
// are covered by tests that need no database.

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` (UTC) for each of the `days` days ending on `now`'s UTC day, oldest first. */
export function trailingDays(days: number, now: Date): string[] {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(new Date(end - i * DAY_MS).toISOString().slice(0, 10));
  }
  return out;
}

/** `YYYY-MM` (UTC) for each of the `months` months ending on `now`'s month, oldest first. */
export function trailingMonths(months: number, now: Date): string[] {
  const out: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/**
 * One row per day with a value per series. A day with no entry becomes `null`,
 * NOT zero: "average first response was 0 hours" and "no ticket was answered
 * that day" are different statements, and the chart draws a gap for the latter.
 * Counts that genuinely are zero when nothing happened pass `zeroFill: true`.
 */
export function fillTrend(
  days: readonly string[],
  series: Record<string, ReadonlyMap<string, number>>,
  opts: { zeroFill?: boolean } = {},
): TrendRow[] {
  const empty = opts.zeroFill ? 0 : null;
  return days.map((date) => {
    const row: TrendRow = { date };
    for (const [key, byDay] of Object.entries(series)) {
      row[key] = byDay.get(date) ?? empty;
    }
    return row;
  });
}

/**
 * Keep the `limit` largest slices and fold the rest into one "other" slice, so a
 * chart of 80 organizations stays readable. Ties keep their input order. The
 * "other" slice is added only when there is something to put in it, and always
 * goes last whatever its size — it is a remainder, not a competitor.
 *
 * A slice already keyed "other" (ticket categories include a real "Other", and a
 * grouped dataset may be grouped again) is part of that remainder: it takes no
 * place, and there is only ever one "other".
 *
 * `keep` names slices that must never be folded away however small (the
 * "Unassigned" pile on a per-technician chart is exactly what someone is looking
 * for). They count toward `limit`, and the largest of the rest fill what is left.
 */
export function topWithOther(
  slices: readonly Slice[],
  limit: number,
  otherName: string,
  keep: readonly string[] = [],
): Slice[] {
  const byValue = (a: Slice, b: Slice) => b.value - a.value;
  const others = slices.filter((s) => s.key === "other");
  const named = slices.filter((s) => s.key !== "other");
  const kept = named.filter((s) => keep.includes(s.key));
  const rest = named.filter((s) => !keep.includes(s.key)).sort(byValue);
  const room = Math.max(0, limit - kept.length);
  const shown = [...kept, ...rest.slice(0, room)].sort(byValue);
  const remainder = [...rest.slice(room), ...others];
  if (remainder.length === 0) return shown;
  const value = round1(remainder.reduce((s, x) => s + x.value, 0));
  const other: Slice = { key: "other", name: otherName, value };
  if (remainder.some((s) => s.overdue !== undefined)) {
    other.overdue = remainder.reduce((s, x) => s + (x.overdue ?? 0), 0);
  }
  return [...shown, other];
}

export type Health = "onTrack" | "atRisk" | "offTrack";

/** How a group of tickets is doing: nothing overdue is on track, up to half
 *  overdue is at risk, more than half is off track. */
export function healthOf(open: number, overdue: number): Health {
  if (overdue <= 0) return "onTrack";
  return overdue * 2 > open ? "offTrack" : "atRisk";
}

/** A proportion in 0..1, or null when there is nothing to measure. */
export function ratio(numerator: number, denominator: number): number | null {
  if (!(denominator > 0)) return null;
  return Math.min(1, Math.max(0, numerator / denominator));
}

/** One decimal place, the precision these charts need. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export const minutesToHours = (minutes: number): number => round1(minutes / 60);

/** Seconds to hours, keeping "no data" as null. */
export function secondsToHours(seconds: number | null | undefined): number | null {
  return seconds === null || seconds === undefined || Number.isNaN(seconds)
    ? null
    : round1(seconds / 3600);
}

/** A 0..1 rate as a whole percentage, keeping "no data" as null. */
export function toPercent(rate: number | null): number | null {
  return rate === null ? null : Math.round(rate * 100);
}

// ── Ticket age ────────────────────────────────────────────────────────────

/** Ordered oldest-last; the queries count into these in the same order. */
export const AGE_BUCKETS = ["d0_1", "d1_3", "d3_7", "d7_14", "d14_plus"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

/**
 * Turn per-bucket counts into slices in bucket order, zeros included: an empty
 * "2+ weeks" bucket is the good news, so it stays on the chart.
 */
export function ageSlices(
  counts: Partial<Record<AgeBucket, number>>,
  names: Record<AgeBucket, string>,
  overdue?: Partial<Record<AgeBucket, number>>,
): Slice[] {
  return AGE_BUCKETS.map((key) => ({
    key,
    name: names[key],
    value: counts[key] ?? 0,
    ...(overdue ? { overdue: overdue[key] ?? 0 } : {}),
  }));
}
