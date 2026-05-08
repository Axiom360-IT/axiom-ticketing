// Pure SLA-due-time math. No DB, no env. Importing this from a vitest
// test file does NOT require DATABASE_URL — that's deliberate, because
// the algorithm is the part that most needs covered cases (DST, weekend
// rollover, holidays).
//
// DB-backed wrappers live in `lib/sla.ts`.

export type Priority = "low" | "medium" | "high" | "critical";

export type BusinessHoursConfig = {
  timezone: string; // IANA, e.g. "America/Toronto"
  startHour: number; // 0–23
  endHour: number; // 1–24, exclusive end
  workingDays: ReadonlySet<string>; // "Mon", "Tue", …
  holidays: ReadonlySet<string>; // YYYY-MM-DD in tz
};

const PARTS_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = PARTS_FORMATTER_CACHE.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hour12: false,
    });
    PARTS_FORMATTER_CACHE.set(tz, f);
  }
  return f;
}

type Parts = {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  weekday: string; // "Mon", "Tue", …
};

function partsOf(d: Date, tz: string): Parts {
  const got = partsFormatter(tz).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of got) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  // hour-12=false sometimes returns 24 for midnight; normalize.
  const hour = Number(map.hour) % 24;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    weekday: map.weekday,
  };
}

/** YYYY-MM-DD that `d` represents in `tz`. */
export function toIsoDate(d: Date, tz: string): string {
  const p = partsOf(d, tz);
  return `${p.year.toString().padStart(4, "0")}-${p.month
    .toString()
    .padStart(2, "0")}-${p.day.toString().padStart(2, "0")}`;
}

/**
 * Given a wall-clock (year, month, day, hour, minute) in `tz`, return the
 * UTC instant that matches. DST-correct via two passes — the second pass
 * compensates for the offset the first guess was wrong about.
 */
function utcFromWallClock(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 2; i++) {
    const seen = partsOf(new Date(guess), tz);
    const seenAsUtc = Date.UTC(
      seen.year,
      seen.month - 1,
      seen.day,
      seen.hour,
      seen.minute,
    );
    const wantedAsUtc = Date.UTC(year, month - 1, day, hour, minute);
    const delta = wantedAsUtc - seenAsUtc;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess);
}

function nextDayStart(d: Date, tz: string, startHour: number): Date {
  // Advance the calendar date in tz by one day. We can't use "+24h to
  // midnight" — on the day a tz falls back from DST that's only 23 hours,
  // and we'd land on 11pm the same day. Calendar arithmetic in UTC
  // (Date.UTC handles day=32 / month-end rollover) avoids that entirely.
  const p = partsOf(d, tz);
  const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return utcFromWallClock(
    tomorrow.getUTCFullYear(),
    tomorrow.getUTCMonth() + 1,
    tomorrow.getUTCDate(),
    startHour,
    0,
    tz,
  );
}

/**
 * Adds `slaMinutes` of business time to `createdAt` and returns the UTC
 * instant when the SLA elapses. When `respectBusinessHours` is false,
 * adds wall-clock minutes (the criticals path).
 */
export function computeDueAt(
  createdAt: Date,
  slaMinutes: number,
  respectBusinessHours: boolean,
  config: BusinessHoursConfig,
): Date {
  if (slaMinutes <= 0) return new Date(createdAt.getTime());
  if (!respectBusinessHours) {
    return new Date(createdAt.getTime() + slaMinutes * 60_000);
  }

  const { timezone: tz, startHour, endHour } = config;

  let cursor = new Date(createdAt.getTime());
  let remaining = slaMinutes;
  const safetyCap = 366; // never walk more than a year forward

  for (let day = 0; day < safetyCap && remaining > 0; day++) {
    const p = partsOf(cursor, tz);
    const dateKey = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
    const isWorking =
      config.workingDays.has(p.weekday) && !config.holidays.has(dateKey);

    if (!isWorking) {
      cursor = nextDayStart(cursor, tz, startHour);
      continue;
    }

    const dayStart = utcFromWallClock(p.year, p.month, p.day, startHour, 0, tz);
    const dayEnd = utcFromWallClock(p.year, p.month, p.day, endHour, 0, tz);

    if (cursor.getTime() >= dayEnd.getTime()) {
      cursor = nextDayStart(cursor, tz, startHour);
      continue;
    }

    const slot =
      cursor.getTime() < dayStart.getTime() ? dayStart : new Date(cursor);
    const minutesAvailable = Math.floor(
      (dayEnd.getTime() - slot.getTime()) / 60_000,
    );
    if (minutesAvailable <= 0) {
      cursor = nextDayStart(cursor, tz, startHour);
      continue;
    }
    const consume = Math.min(remaining, minutesAvailable);
    cursor = new Date(slot.getTime() + consume * 60_000);
    remaining -= consume;
  }

  return cursor;
}
