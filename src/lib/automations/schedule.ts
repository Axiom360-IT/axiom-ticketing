// ── When is a scheduled report due? ───────────────────────────────────
//
// Pure, so it can be tested without a database or a clock. Everything that
// could silently send the wrong report at the wrong hour lives in here.
//
// Why this exists at all, rather than one Inngest cron per report: a cron
// expression is written in code and deployed. A report the IT Director can
// create at 16:05 and expect at 19:00 the same day cannot be. So one
// dispatcher wakes every five minutes and asks this function what is due.
//
// All eight existing crons run in UTC — not one carries a `TZ=` prefix. The
// dispatcher is no different, which means "19:00" has to be interpreted here,
// in the operator's configured timezone, not left to the scheduler.

export const WEEKDAYS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export function isWeekday(v: unknown): v is Weekday {
  return typeof v === "string" && (WEEKDAYS as readonly string[]).includes(v);
}

export type LocalMoment = {
  /** YYYY-MM-DD in the target timezone — the double-send key. */
  date: string;
  weekday: Weekday;
  hour: number;
  minute: number;
  /** Minutes since local midnight. */
  minutesOfDay: number;
};

/**
 * Break an instant down into wall-clock parts in `timeZone`.
 *
 * Uses Intl, which ships with Node and carries the full IANA database —
 * including DST transitions, which a manual UTC-offset calculation gets wrong
 * twice a year. An unknown or malformed zone throws, so the caller falls back
 * to UTC rather than guessing an offset.
 */
export function localMoment(at: Date, timeZone: string): LocalMoment {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });

  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(at)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }

  // en-CA gives hour "24" for midnight rather than "00".
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: (isWeekday(parts.weekday) ? parts.weekday : "Sun") as Weekday,
    hour,
    minute,
    minutesOfDay: hour * 60 + minute,
  };
}

/** Falls back to UTC for a zone Intl does not recognise, instead of throwing
 *  inside a cron and losing every report in the batch. */
export function safeLocalMoment(at: Date, timeZone: string): LocalMoment {
  try {
    return localMoment(at, timeZone);
  } catch {
    return localMoment(at, "UTC");
  }
}

export type DueCheckInput = {
  hour: number;
  minute: number;
  weekdays: readonly string[];
  enabled: boolean;
  /** Local date this last sent for, or null if never. */
  lastRunOn: string | null;
};

export type DueVerdict =
  | { due: true; forDate: string }
  | { due: false; reason: "disabled" | "wrong-day" | "too-early" | "already-sent" };

/**
 * Whether a report should go out at this instant.
 *
 * Deliberately "at or after", not "equals": the dispatcher fires every five
 * minutes, so an exact match would miss a report scheduled at 19:02 forever.
 * `lastRunOn` is what keeps "at or after" from meaning "every five minutes
 * until midnight".
 *
 * A consequence worth stating: a report created at 19:30 for 19:00 goes out
 * immediately, because 19:30 is after 19:00 and it has not sent today. That is
 * the better failure — the alternative is silence until tomorrow, which reads
 * as broken.
 */
export function isReportDue(
  report: DueCheckInput,
  now: LocalMoment,
): DueVerdict {
  if (!report.enabled) return { due: false, reason: "disabled" };
  if (!report.weekdays.includes(now.weekday)) {
    return { due: false, reason: "wrong-day" };
  }
  if (report.lastRunOn === now.date) {
    return { due: false, reason: "already-sent" };
  }
  const target = report.hour * 60 + report.minute;
  if (now.minutesOfDay < target) return { due: false, reason: "too-early" };
  return { due: true, forDate: now.date };
}

/** "19:00" — for display next to a UTC cron expression. */
export function formatLocalTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * What a UTC cron expression means in `timeZone`, for the handful of shapes
 * this app actually uses. Returns null for anything it cannot describe
 * honestly — the UI then shows the raw expression rather than a guess.
 *
 *   "0 6 * * *"      → daily at a fixed hour → local time
 *   "30 3 * * *"     → same
 *   "0 * * * *"      → hourly                → no local time to show
 *   every-N-minutes  → same
 */
export function describeCronLocally(
  cron: string,
  timeZone: string,
  reference: Date,
): { kind: "daily"; localTime: string } | { kind: "interval" } | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts;
  if (dom !== "*" || mon !== "*" || dow !== "*") return null;

  // Fixed minute AND hour → a once-a-day job with a real local time.
  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) {
    const utcMidnight = new Date(
      Date.UTC(
        reference.getUTCFullYear(),
        reference.getUTCMonth(),
        reference.getUTCDate(),
        Number(hour),
        Number(min),
      ),
    );
    const local = safeLocalMoment(utcMidnight, timeZone);
    return {
      kind: "daily",
      localTime: formatLocalTime(local.hour, local.minute),
    };
  }

  return { kind: "interval" };
}
