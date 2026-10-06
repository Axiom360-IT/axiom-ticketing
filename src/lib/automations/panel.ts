import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { roles } from "@/lib/db/schema/rbac";
import { scheduledReports } from "@/lib/db/schema/automations";
import { getSettings } from "@/lib/settings";
import { SETTING_KEYS } from "@/lib/settings-registry";
import {
  AUTOMATIONS,
  AUTOMATION_ENABLED_KEYS,
  type AutomationDef,
  TRACKED_AUTOMATION_IDS,
} from "./registry";
import {
  type AutomationRunRow,
  failureCounts,
  latestRunByAutomation,
  listRecentRuns,
} from "./runs";
import { describeCronLocally, safeLocalMoment } from "./schedule";

// ── Everything the Automations page renders, in one load ──────────────

export type AutomationCard = {
  def: AutomationDef;
  /** Resolved from `enabledKey`; true when the job has no switch. */
  enabled: boolean;
  /** Null when the job has no switch of its own — the UI shows "always on". */
  enabledKey: string | null;
  lastRun: AutomationRunRow | null;
  failures24h: number;
  /** What the UTC cron means locally, when that can be said honestly. */
  localSchedule:
    | { kind: "daily"; localTime: string }
    | { kind: "interval" }
    | null;
  /** Current values of this job's knobs, for inline display. */
  settings: { key: string; value: unknown }[];
};

export type AutomationPanel = {
  timezone: string;
  /** Local time at render, so the page can say "it is 14:32 where you are". */
  localNow: string;
  scheduled: AutomationCard[];
  reactive: AutomationCard[];
  recentRuns: AutomationRunRow[];
  reports: (typeof scheduledReports.$inferSelect)[];
  /** For the recipient pickers. */
  staff: { id: string; name: string; email: string }[];
  roleNames: string[];
  /** SLA targets, for the form that was built and never mounted. */
  sla: Record<
    "critical" | "high" | "medium" | "low",
    {
      responseMinutes: number;
      resolveMinutes: number;
      respectBusinessHours: boolean;
    }
  >;
};

const SLA_FALLBACK = {
  critical: { responseMinutes: 30, resolveMinutes: 240, respectBusinessHours: false },
  high: { responseMinutes: 60, resolveMinutes: 480, respectBusinessHours: true },
  medium: { responseMinutes: 240, resolveMinutes: 1440, respectBusinessHours: true },
  low: { responseMinutes: 480, resolveMinutes: 2880, respectBusinessHours: true },
} as const;

export async function loadAutomationPanel(): Promise<AutomationPanel> {
  // Every knob referenced by the registry, plus the switches, plus the SLA
  // block and the timezone — one settings read for the whole page.
  const wanted = new Set<string>([
    "business_hours.timezone",
    ...AUTOMATION_ENABLED_KEYS,
    ...AUTOMATIONS.flatMap((a) => a.settingKeys ?? []),
  ]);
  for (const p of ["critical", "high", "medium", "low"]) {
    wanted.add(`sla.${p}.response_minutes`);
    wanted.add(`sla.${p}.resolve_minutes`);
    wanted.add(`sla.${p}.respect_business_hours`);
  }
  // Guard against a registry entry naming a key that no longer exists.
  const keys = [...wanted].filter((k) =>
    (SETTING_KEYS as readonly string[]).includes(k),
  );

  const [settingValues, latest, failures, recentRuns, reports, staff, roleRows] =
    await Promise.all([
      getSettings(keys) as Promise<Record<string, unknown>>,
      latestRunByAutomation(TRACKED_AUTOMATION_IDS),
      failureCounts(TRACKED_AUTOMATION_IDS, 24),
      listRecentRuns(40),
      db
        .select()
        .from(scheduledReports)
        .orderBy(desc(scheduledReports.createdAt)),
      db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.isActive, true))
        .orderBy(users.name),
      db.select({ name: roles.name }).from(roles).orderBy(roles.name),
    ]);

  const tzRaw = settingValues["business_hours.timezone"];
  const timezone =
    typeof tzRaw === "string" && tzRaw.trim() ? tzRaw : "UTC";
  const now = new Date();
  const local = safeLocalMoment(now, timezone);

  const toCard = (def: AutomationDef): AutomationCard => {
    const enabledKey = def.enabledKey ?? null;
    const raw = enabledKey ? settingValues[enabledKey] : undefined;
    return {
      def,
      // Absent means on: every one of these defaults to enabled in the job
      // itself, and the panel must agree with the job rather than guess.
      enabled: typeof raw === "boolean" ? raw : true,
      enabledKey,
      lastRun: latest.get(def.id) ?? null,
      failures24h: failures.get(def.id) ?? 0,
      localSchedule: def.cron
        ? describeCronLocally(def.cron, timezone, now)
        : null,
      settings: (def.settingKeys ?? []).map((key) => ({
        key,
        value: settingValues[key],
      })),
    };
  };

  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && v > 0 ? v : fallback;
  const bool = (v: unknown, fallback: boolean) =>
    typeof v === "boolean" ? v : fallback;

  const sla = Object.fromEntries(
    (["critical", "high", "medium", "low"] as const).map((p) => [
      p,
      {
        responseMinutes: num(
          settingValues[`sla.${p}.response_minutes`],
          SLA_FALLBACK[p].responseMinutes,
        ),
        resolveMinutes: num(
          settingValues[`sla.${p}.resolve_minutes`],
          SLA_FALLBACK[p].resolveMinutes,
        ),
        respectBusinessHours: bool(
          settingValues[`sla.${p}.respect_business_hours`],
          SLA_FALLBACK[p].respectBusinessHours,
        ),
      },
    ]),
  ) as AutomationPanel["sla"];

  return {
    timezone,
    localNow: `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`,
    scheduled: AUTOMATIONS.filter((a) => a.kind === "scheduled").map(toCard),
    reactive: AUTOMATIONS.filter((a) => a.kind === "reactive").map(toCard),
    recentRuns,
    reports,
    staff,
    roleNames: roleRows.map((r) => r.name),
    sla,
  };
}
