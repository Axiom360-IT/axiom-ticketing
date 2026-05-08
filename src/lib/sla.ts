import { eq, gte, lte, and } from "drizzle-orm";
import { db } from "./db/client";
import { holidays } from "./db/schema/holidays";
import { tickets } from "./db/schema/tickets";
import { getSettings } from "./settings";
import {
  type BusinessHoursConfig,
  computeDueAt,
  type Priority,
} from "./sla-compute";

// Re-export the pure module's types/fn so consumers only ever import
// from `lib/sla` (DB-aware) and tests import from `lib/sla-compute`.
export {
  computeDueAt,
  toIsoDate,
  type BusinessHoursConfig,
  type Priority,
} from "./sla-compute";

// ── DB-backed wrappers ──────────────────────────────────────────────

export type SlaSettings = {
  config: BusinessHoursConfig;
  /** Per-priority targets in minutes. */
  targets: Record<
    Priority,
    {
      responseMinutes: number;
      resolveMinutes: number;
      respectBusinessHours: boolean;
    }
  >;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const SETTING_KEYS = [
  "business_hours.timezone",
  "business_hours.start_hour",
  "business_hours.end_hour",
  "business_hours.working_days",
  "sla.critical.response_minutes",
  "sla.critical.resolve_minutes",
  "sla.critical.respect_business_hours",
  "sla.high.response_minutes",
  "sla.high.resolve_minutes",
  "sla.high.respect_business_hours",
  "sla.medium.response_minutes",
  "sla.medium.resolve_minutes",
  "sla.medium.respect_business_hours",
  "sla.low.response_minutes",
  "sla.low.resolve_minutes",
  "sla.low.respect_business_hours",
] as const;

const FALLBACK_TARGETS: SlaSettings["targets"] = {
  critical: { responseMinutes: 60, resolveMinutes: 240, respectBusinessHours: false },
  high: { responseMinutes: 240, resolveMinutes: 1440, respectBusinessHours: true },
  medium: { responseMinutes: 480, resolveMinutes: 2880, respectBusinessHours: true },
  low: { responseMinutes: 1440, resolveMinutes: 7200, respectBusinessHours: true },
};

function asNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function asBoolean(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function asString(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function toIsoDateUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Loads SLA + business-hours settings + holidays in `[from, to]`.
 */
export async function loadSlaSettings(
  fromDate: Date,
  toDate: Date,
): Promise<SlaSettings> {
  const settings = (await getSettings(SETTING_KEYS)) as Record<string, unknown>;

  const fromIso = toIsoDateUtc(fromDate);
  const toIso = toIsoDateUtc(toDate);
  const holidayRows = await db
    .select({ date: holidays.date })
    .from(holidays)
    .where(and(gte(holidays.date, fromIso), lte(holidays.date, toIso)));

  const config: BusinessHoursConfig = {
    timezone: asString(settings["business_hours.timezone"], "UTC"),
    startHour: asNumber(settings["business_hours.start_hour"], 9),
    endHour: asNumber(settings["business_hours.end_hour"], 18),
    workingDays: new Set(
      asStringArray(settings["business_hours.working_days"]).filter((d) =>
        (DAY_NAMES as readonly string[]).includes(d),
      ),
    ),
    holidays: new Set(holidayRows.map((h) => h.date)),
  };

  const priorities: Priority[] = ["critical", "high", "medium", "low"];
  const targets = {} as SlaSettings["targets"];
  for (const p of priorities) {
    targets[p] = {
      responseMinutes: asNumber(
        settings[`sla.${p}.response_minutes`],
        FALLBACK_TARGETS[p].responseMinutes,
      ),
      resolveMinutes: asNumber(
        settings[`sla.${p}.resolve_minutes`],
        FALLBACK_TARGETS[p].resolveMinutes,
      ),
      respectBusinessHours: asBoolean(
        settings[`sla.${p}.respect_business_hours`],
        FALLBACK_TARGETS[p].respectBusinessHours,
      ),
    };
  }

  return { config, targets };
}

/**
 * Compute response + resolution due times for a brand-new ticket. Uses
 * a 1-year forward window for holidays — far longer than any real SLA
 * target, so we never miss one.
 */
export async function computeDueTimesForNewTicket(opts: {
  createdAt: Date;
  priority: Priority;
}): Promise<{ responseDueAt: Date; resolutionDueAt: Date }> {
  const oneYearOut = new Date(opts.createdAt.getTime() + 366 * 24 * 60 * 60_000);
  const sla = await loadSlaSettings(opts.createdAt, oneYearOut);
  const t = sla.targets[opts.priority];
  return {
    responseDueAt: computeDueAt(
      opts.createdAt,
      t.responseMinutes,
      t.respectBusinessHours,
      sla.config,
    ),
    resolutionDueAt: computeDueAt(
      opts.createdAt,
      t.resolveMinutes,
      t.respectBusinessHours,
      sla.config,
    ),
  };
}

/**
 * Recompute and persist due times for an existing ticket. Used when the
 * priority changes mid-flight. No-op if the ticket is already resolved
 * or closed (we don't move a deadline backwards into the past).
 */
export async function recomputeSlaForTicket(ticketId: string): Promise<void> {
  const [t] = await db
    .select({
      id: tickets.id,
      priority: tickets.priority,
      status: tickets.status,
      createdAt: tickets.createdAt,
    })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!t) return;
  if (t.status === "resolved" || t.status === "closed") return;

  const due = await computeDueTimesForNewTicket({
    createdAt: t.createdAt,
    priority: t.priority as Priority,
  });

  await db
    .update(tickets)
    .set({
      responseDueAt: due.responseDueAt,
      resolutionDueAt: due.resolutionDueAt,
      slaWarning50At: null,
      slaWarning80At: null,
      slaBreachedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(tickets.id, ticketId));
}
