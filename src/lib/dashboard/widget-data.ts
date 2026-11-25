import "server-only";
import { getFormatter, getTranslations } from "next-intl/server";
import type { SessionUser } from "@/lib/auth/can";
import { loadCsatMonthlyTrend } from "@/lib/reports/queries";
import { loadAllTicketCategories } from "@/lib/tickets/categories";
import { loadAllTicketTypes } from "@/lib/tickets/types";
import type { Slice, TrendRow, WidgetData } from "./chart-spec";
import {
  ageSlices,
  AGE_BUCKETS,
  fillTrend,
  minutesToHours,
  ratio,
  secondsToHours,
  toPercent,
  topWithOther,
  trailingDays,
  trailingMonths,
  type AgeBucket,
} from "./metrics";
import * as q from "./queries";
import { viewerOf } from "./store";
import { getWidget } from "./widgets";

// ── Turning a widget id into chart-ready data ─────────────────────────────
//
// Used twice: by the dashboard page for the on-demand widgets a person has on
// their dashboard, and by the `loadDashboardWidget` server action when they add
// one. Either way it re-checks the widget against the caller's CURRENT
// permissions, so asking for a widget by id can never return data the person may
// not see.

const WINDOW_DAYS = 30;
const CSAT_MONTHS = 6;
const TOP_N = 10;
const TOP_PEOPLE = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Returns null for an unknown widget, one that is not on-demand, or one this
 *  person may not have. */
export async function loadWidgetData(
  id: string,
  user: SessionUser,
): Promise<WidgetData | null> {
  const def = getWidget(id);
  if (!def?.lazy || !def.metricKey || !def.isAvailable(viewerOf(user))) return null;

  const t = await getTranslations("admin.landing.metrics");
  const formatter = await getFormatter();
  const m = def.metricKey;
  const now = new Date();

  // Each widget's subtitle may mention the window it covers.
  const subtitle = (values?: Record<string, string | number>) => t(`${m}.subtitle`, values);
  const dayLabel = (iso: string) =>
    formatter.dateTime(new Date(`${iso}T12:00:00Z`), { month: "short", day: "numeric" });
  const labelled = (rows: TrendRow[]): TrendRow[] =>
    rows.map((r) => ({ ...r, date: dayLabel(r.date) }));
  const windowDays = trailingDays(WINDOW_DAYS, now);
  const windowStart = new Date(`${windowDays[0]}T00:00:00Z`);

  switch (def.id) {
    // ── Ticket mix ───────────────────────────────────────────────────────
    case "chart.byTechnician": {
      const slices: Slice[] = (await q.activeByTechnician()).map((r) => ({
        key: r.userId ?? "unassigned",
        name: r.name ?? t("unassigned"),
        value: r.value,
        overdue: r.overdue,
      }));
      return {
        subtitle: subtitle(),
        spec: { kind: "category", palette: "cycle", data: topWithOther(slices, TOP_PEOPLE, t("other"), ["unassigned"]) },
      };
    }
    case "chart.byCategory": {
      const labels = new Map((await loadAllTicketCategories()).map((c) => [c.value, c.label]));
      const slices = (await q.activeByColumn("category")).map((r) => ({
        key: r.key,
        name: labels.get(r.key) ?? r.key,
        value: r.value,
        overdue: r.overdue,
      }));
      return { subtitle: subtitle(), spec: { kind: "category", palette: "cycle", data: topWithOther(slices, TOP_N, t("other")) } };
    }
    case "chart.byType": {
      const labels = new Map((await loadAllTicketTypes()).map((x) => [x.value, x.label]));
      const slices = (await q.activeByColumn("type")).map((r) => ({
        key: r.key,
        name: labels.get(r.key) ?? r.key,
        value: r.value,
        overdue: r.overdue,
      }));
      return { subtitle: subtitle(), spec: { kind: "category", palette: "cycle", data: topWithOther(slices, TOP_N, t("other")) } };
    }
    case "chart.byStream": {
      const slices = (await q.activeByColumn("stream")).map((r) => ({
        key: r.key,
        name: r.key === "internal" || r.key === "external" ? t(`stream.${r.key}`) : r.key,
        value: r.value,
        overdue: r.overdue,
      }));
      return { subtitle: subtitle(), spec: { kind: "category", palette: "cycle", data: slices } };
    }
    case "chart.byOrganization": {
      const slices: Slice[] = (await q.activeByOrganization()).map((r) => ({
        key: r.id ?? "none",
        name: r.name ?? t("noOrganization"),
        value: r.value,
        overdue: r.overdue,
      }));
      return {
        subtitle: subtitle({ n: TOP_N }),
        spec: { kind: "category", palette: "cycle", data: topWithOther(slices, TOP_N, t("other"), ["none"]) },
      };
    }
    case "chart.age": {
      const names = Object.fromEntries(AGE_BUCKETS.map((k) => [k, t(`age.${k}`)])) as Record<AgeBucket, string>;
      const { open, overdue } = await q.activeAgeCounts();
      return {
        subtitle: subtitle(),
        spec: { kind: "category", palette: "cycle", data: ageSlices(open, names, overdue) },
      };
    }

    // ── Over time ────────────────────────────────────────────────────────
    case "chart.backlog": {
      const byDay = await q.backlogByDay(windowDays);
      return {
        subtitle: subtitle({ days: WINDOW_DAYS }),
        spec: {
          kind: "trend",
          series: [{ key: "backlog", name: t("backlog.series"), tone: "blue" }],
          data: labelled(fillTrend(windowDays, { backlog: byDay }, { zeroFill: true })),
        },
      };
    }
    case "chart.firstResponse":
    case "chart.resolutionTime": {
      const raw =
        def.id === "chart.firstResponse"
          ? await q.avgFirstResponseByDay(windowStart)
          : await q.avgResolutionByDay(windowStart);
      const hours = new Map<string, number>();
      for (const [day, seconds] of raw) {
        const h = secondsToHours(seconds);
        if (h !== null) hours.set(day, h);
      }
      return {
        subtitle: subtitle({ days: WINDOW_DAYS }),
        spec: {
          kind: "trend",
          series: [{ key: "hours", name: t(`${m}.series`), tone: def.id === "chart.firstResponse" ? "amber" : "purple" }],
          data: labelled(fillTrend(windowDays, { hours })),
          unit: "h",
        },
      };
    }
    case "chart.csatTrend": {
      const months = trailingMonths(CSAT_MONTHS, now);
      const percent = new Map<string, number>();
      for (const p of await loadCsatMonthlyTrend(undefined, CSAT_MONTHS)) {
        const v = toPercent(p.positiveRate);
        if (v !== null) percent.set(p.month, v);
      }
      const rows = fillTrend(months, { positive: percent }).map((r) => ({
        ...r,
        date: formatter.dateTime(new Date(`${r.date}-01T12:00:00Z`), { month: "short", year: "numeric" }),
      }));
      return {
        subtitle: subtitle({ months: CSAT_MONTHS }),
        spec: { kind: "trend", series: [{ key: "positive", name: t("csatTrend.series"), tone: "green" }], data: rows, unit: "%" },
      };
    }

    // ── Single numbers ───────────────────────────────────────────────────
    case "ratio.sla": {
      const { total, breached } = await q.slaOutcome(new Date(now.getTime() - WINDOW_DAYS * DAY_MS));
      const met = total - breached;
      return {
        subtitle: subtitle({ days: WINDOW_DAYS }),
        spec: {
          kind: "ratio",
          value: ratio(met, total),
          label: t("sla.label"),
          detail: total > 0 ? t("sla.detail", { met, total }) : undefined,
        },
      };
    }
    case "ratio.escalation": {
      const { total, escalated } = await q.escalationOutcome(new Date(now.getTime() - WINDOW_DAYS * DAY_MS));
      return {
        subtitle: subtitle({ days: WINDOW_DAYS }),
        spec: {
          kind: "ratio",
          value: ratio(escalated, total),
          label: t("escalation.label"),
          detail: total > 0 ? t("escalation.detail", { escalated, total }) : undefined,
        },
      };
    }

    // ── Time logged ──────────────────────────────────────────────────────
    case "chart.hoursByTechnician": {
      const slices: Slice[] = (await q.minutesByTechnician(windowStart))
        .filter((r) => r.minutes > 0)
        .map((r) => ({ key: r.userId ?? "unknown", name: r.name ?? t("unknownTechnician"), value: minutesToHours(r.minutes) }));
      return {
        subtitle: subtitle({ days: WINDOW_DAYS }),
        spec: { kind: "category", palette: "cycle", data: topWithOther(slices, TOP_PEOPLE, t("other")), unit: "h" },
      };
    }
    case "chart.hoursByBilling": {
      const slices: Slice[] = (await q.minutesByBilling(windowStart))
        .filter((r) => r.minutes > 0)
        .map((r) => {
          const key = r.billable ?? "unset";
          return { key, name: t(`billing.${key}`), value: minutesToHours(r.minutes) };
        });
      return {
        subtitle: subtitle({ days: WINDOW_DAYS }),
        spec: { kind: "category", palette: "cycle", data: slices, unit: "h" },
      };
    }

    default:
      return null;
  }
}
