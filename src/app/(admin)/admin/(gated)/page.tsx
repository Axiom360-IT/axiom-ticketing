import Link from "next/link";
import { redirect } from "next/navigation";
import {
  and,
  type AnyColumn,
  count,
  eq,
  gte,
  inArray,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import { getFormatter, getTranslations } from "next-intl/server";
import {
  AlarmClock,
  AlertTriangle,
  ChevronRight,
  ClipboardCheck,
  Gauge,
  CircleCheck,
  CircleDot,
  Hourglass,
  Inbox,
  PauseCircle,
  Ticket as TicketIcon,
  UserPlus,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DashboardGrid,
  type DashboardSlot,
} from "@/components/dashboard/dashboard-grid";
import {
  EscalatedBadge,
  PriorityBadge,
} from "@/components/tickets/badges";
import { isStrictTechnician } from "@/lib/auth/can";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema/tickets";
import { defaultLayout } from "@/lib/dashboard/layout";
import { loadDashboardLayout, viewerOf } from "@/lib/dashboard/store";
import { loadWidgetData } from "@/lib/dashboard/widget-data";
import { availableWidgets, getWidget, isLazyWidget, type WidgetId } from "@/lib/dashboard/widgets";
import { loadMyQueue, type MyQueue as MyQueueData } from "@/lib/tickets/my-queue";
import { loadSlaBoard, type SlaBoard as SlaBoardData } from "@/lib/tickets/sla-board";
import {
  loadEscalationsBoard,
  type EscalationsBoard as EscalationsBoardData,
} from "@/lib/tickets/escalations-board";
import {
  loadTriagePanel,
  type TriagePanel as TriagePanelData,
} from "@/lib/tickets/triage-panel";
import {
  loadPlanWatch,
  type PlanWatch as PlanWatchData,
} from "@/lib/billing/plan-watch";
import { loadDashboardCsat } from "@/lib/reports/queries";
import { CSAT_EMOJI, type CsatRating } from "@/lib/tickets/csat-display";
import { cn } from "@/lib/utils";
import type { Permission } from "@/lib/auth/permissions";

// Deep-link from a dashboard CSAT tile to the tickets list, pre-filtered to
// that rating (and technician, when clicking a per-tech row). `view=all` so
// rated tickets that have since closed/reopened still show.
function csatTicketsHref(
  rating: CsatRating,
  technicianId?: string | null,
): string {
  const p = new URLSearchParams({ view: "all", csat: rating });
  if (technicianId) p.set("assignee", technicianId);
  return `/admin/tickets?${p.toString()}`;
}

// Quick-stat queries used to populate the landing dashboard. Each one
// is gated by the caller's permissions — we only run the query when
// the stat would actually be visible. `null` = caller doesn't have
// permission (placeholder rendered); a number = visible (incl. `0`).
// Counts are global (not visibility-scoped), matching the existing dashboard.

async function getStats(perms: Set<Permission>) {
  const canTickets = perms.has("tickets.view");
  const notDeleted = isNull(tickets.deletedAt);
  const one = (rows: { value: number }[] | null) =>
    rows ? Number(rows[0]?.value ?? 0) : null;

  const [total, open, unassigned, awaiting, onHold, resolved] =
    await Promise.all([
      canTickets
        ? db.select({ value: count() }).from(tickets).where(notDeleted)
        : Promise.resolve(null),
      canTickets
        ? db
            .select({ value: count() })
            .from(tickets)
            .where(
              and(inArray(tickets.status, ["open", "in_progress"]), notDeleted),
            )
        : Promise.resolve(null),
      perms.has("tickets.assign")
        ? db
            .select({ value: count() })
            .from(tickets)
            .where(
              and(
                eq(tickets.status, "open"),
                isNull(tickets.assignedToId),
                notDeleted,
              ),
            )
        : Promise.resolve(null),
      // Paused-clock statuses surfaced as their own metrics (SLA is frozen
      // while a ticket sits here, so they're worth watching separately).
      canTickets
        ? db
            .select({ value: count() })
            .from(tickets)
            .where(
              and(
                eq(tickets.status, "awaiting_customer_confirmation"),
                notDeleted,
              ),
            )
        : Promise.resolve(null),
      canTickets
        ? db
            .select({ value: count() })
            .from(tickets)
            .where(and(eq(tickets.status, "on_hold"), notDeleted))
        : Promise.resolve(null),
      canTickets
        ? db
            .select({ value: count() })
            .from(tickets)
            .where(and(eq(tickets.status, "resolved"), notDeleted))
        : Promise.resolve(null),
    ]);

  return {
    total: one(total),
    openTickets: one(open),
    unassigned: one(unassigned),
    awaiting: one(awaiting),
    onHold: one(onHold),
    resolved: one(resolved),
  };
}

// Chart datasets for the landing dashboard — status mix, the trailing 14-day
// created-vs-resolved trend, and the active-ticket priority split. Returns null
// when the caller can't view tickets (charts are hidden entirely). Days are
// bucketed in UTC — a dashboard-level trend, not a business-hours report.
const TREND_DAYS = 14;

async function getChartData(perms: Set<Permission>) {
  if (!perms.has("tickets.view")) return null;
  const notDeleted = isNull(tickets.deletedAt);

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (TREND_DAYS - 1));

  const dayExpr = (col: AnyColumn) =>
    sql<string>`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

  const [statusRows, priorityRows, createdByDay, resolvedByDay] =
    await Promise.all([
      db
        .select({ status: tickets.status, value: count() })
        .from(tickets)
        .where(notDeleted)
        .groupBy(tickets.status),
      db
        .select({ priority: tickets.priority, value: count() })
        .from(tickets)
        .where(and(ne(tickets.status, "closed"), notDeleted))
        .groupBy(tickets.priority),
      db
        .select({ day: dayExpr(tickets.createdAt), value: count() })
        .from(tickets)
        .where(and(gte(tickets.createdAt, since), notDeleted))
        .groupBy(dayExpr(tickets.createdAt)),
      db
        .select({ day: dayExpr(tickets.resolvedAt), value: count() })
        .from(tickets)
        .where(and(gte(tickets.resolvedAt, since), notDeleted))
        .groupBy(dayExpr(tickets.resolvedAt)),
    ]);

  const statusMap = new Map(statusRows.map((r) => [r.status, Number(r.value)]));
  const priorityMap = new Map(
    priorityRows.map((r) => [r.priority, Number(r.value)]),
  );
  const createdMap = new Map(createdByDay.map((r) => [r.day, Number(r.value)]));
  const resolvedMap = new Map(
    resolvedByDay.map((r) => [r.day, Number(r.value)]),
  );

  const MAIN_STATUSES = [
    "open",
    "in_progress",
    "awaiting_customer_confirmation",
    "on_hold",
    "resolved",
    "closed",
  ];
  const otherTotal = statusRows
    .filter((r) => !MAIN_STATUSES.includes(r.status))
    .reduce((s, r) => s + Number(r.value), 0);

  const trend: { day: string; created: number; resolved: number }[] = [];
  for (let i = 0; i < TREND_DAYS; i++) {
    const d = new Date(since);
    d.setUTCDate(since.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    trend.push({
      day: key,
      created: createdMap.get(key) ?? 0,
      resolved: resolvedMap.get(key) ?? 0,
    });
  }

  return {
    statusMap,
    priorityMap,
    otherTotal,
    trend,
  };
}

export default async function AdminLanding() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  const t = await getTranslations("admin.landing");
  const tStatus = await getTranslations("tickets.status");
  const tPriority = await getTranslations("tickets.priority");
  const tEscReason = await getTranslations("tickets.escalationReason");
  const formatter = await getFormatter();

  // A strict Technician can't act on org-wide numbers and only owns their own
  // tickets — so their dashboard IS My Queue: we skip the global stats/charts
  // entirely rather than showing counts they can neither act on nor see scoped.
  const strictTech = isStrictTechnician(user);
  const canViewTickets = user.permissions.has("tickets.view");
  // The triage tiles gate on their own destination-page permissions: held
  // replies (moderation) on tickets.update, unverified orgs (org-triage) on
  // organizations.update. A strict Technician gets neither — their dashboard
  // stays My Queue only, like the other oversight panels.
  const canModerate = user.permissions.has("tickets.update");
  const canTriageOrgs = user.permissions.has("organizations.update");
  // Plan watch is a commercial-risk surface gated on its destination page's
  // permission (organizations.view, which no Technician role holds).
  const canViewOrgs = user.permissions.has("organizations.view");

  // Read the saved arrangement alongside the data (it never throws; see store.ts).
  const layoutPromise = loadDashboardLayout(user);
  // On-demand chart widgets are loaded only if they are on this person's
  // dashboard, in parallel with everything else. A failure leaves that one
  // widget showing "try again" rather than breaking the page.
  const lazyPromise = layoutPromise.then(({ layout }) =>
    Promise.all(
      layout.items
        .filter((i) => isLazyWidget(i.id))
        .map(async (i) => {
          try {
            return [i.id, await loadWidgetData(i.id, user)] as const;
          } catch (err) {
            console.error("[dashboard] widget data failed", i.id, err);
            return [i.id, null] as const;
          }
        }),
    ),
  );

  const [stats, chart, myQueue, slaBoard, escalations, triage, planWatch, csat] =
    await Promise.all([
      strictTech ? Promise.resolve(null) : getStats(user.permissions),
      strictTech ? Promise.resolve(null) : getChartData(user.permissions),
      canViewTickets ? loadMyQueue(user.id) : Promise.resolve(null),
      !strictTech && canViewTickets ? loadSlaBoard(user) : Promise.resolve(null),
      !strictTech && canViewTickets
        ? loadEscalationsBoard(user)
        : Promise.resolve(null),
      !strictTech && (canModerate || canTriageOrgs)
        ? loadTriagePanel(user, canModerate, canTriageOrgs)
        : Promise.resolve(null),
      !strictTech && canViewOrgs ? loadPlanWatch() : Promise.resolve(null),
      // CSAT summary is an oversight metric — shown to non-strict-tech viewers
      // who can see tickets, hidden (below) until there's at least one response.
      !strictTech && canViewTickets
        ? loadDashboardCsat()
        : Promise.resolve(null),
    ]);

  // My Queue is a personal work surface: always shown to a strict Technician
  // (it IS their dashboard), and to elevated roles only when they actually own
  // in-flight work — so an oversight user who never gets assigned tickets isn't
  // shown a permanently-empty panel.
  const showMyQueue = !!myQueue && (strictTech || myQueue.counts.assigned > 0);

  // The SLA board is oversight-only — a strict Technician's own at-risk work is
  // already the "My SLA at-risk" chip in My Queue — and it hides entirely on a
  // clean day so it never nags when there's nothing to act on.
  const showSlaBoard =
    !!slaBoard && (slaBoard.counts.breached > 0 || slaBoard.counts.atRisk > 0);

  // Escalations board — oversight-only (a strict Technician's escalations show
  // in their My Queue chip); hidden when none are open.
  const showEscalations = !!escalations && escalations.total > 0;

  // Triage panel — hidden unless there's actually something held or unverified
  // that the viewer is permitted to clear.
  const showTriage =
    !!triage && ((triage.held ?? 0) > 0 || (triage.unverified ?? 0) > 0);

  // Plan watch — exceptions-only, hidden when no org is over or near its plan.
  const showPlanWatch = !!planWatch && planWatch.items.length > 0;

  const displayRoles =
    user.roleNames.size > 0 ? [...user.roleNames].join(", ") : t("noRoles");

  // Shape chart data with translated labels (colours live in the chart
  // component, keyed by the stable `key`).
  const statusLabels: Record<string, string> = {
    open: tStatus("open"),
    in_progress: tStatus("in_progress"),
    awaiting_customer_confirmation: tStatus("awaiting_customer_confirmation"),
    on_hold: tStatus("on_hold"),
    resolved: tStatus("resolved"),
    closed: tStatus("closed"),
    other: t("statusOther"),
  };
  const priorityLabels: Record<string, string> = {
    low: tPriority("low"),
    medium: tPriority("medium"),
    high: tPriority("high"),
    critical: tPriority("critical"),
  };
  const escalationReasonLabels: Record<string, string> = {
    beyond_scope: tEscReason("beyond_scope"),
    requires_access: tEscReason("requires_access"),
    critical_impact: tEscReason("critical_impact"),
    vendor_involvement: tEscReason("vendor_involvement"),
    other: tEscReason("other"),
  };

  const statusData = chart
    ? [
        ...[
          "open",
          "in_progress",
          "awaiting_customer_confirmation",
          "on_hold",
          "resolved",
          "closed",
        ].map((key) => ({
          key,
          name: statusLabels[key],
          value: chart.statusMap.get(key) ?? 0,
        })),
        ...(chart.otherTotal > 0
          ? [{ key: "other", name: statusLabels.other, value: chart.otherTotal }]
          : []),
      ].filter((s) => s.value > 0)
    : [];
  const priorityData = chart
    ? ["low", "medium", "high", "critical"].map((key) => ({
        key,
        name: priorityLabels[key],
        value: chart.priorityMap.get(key) ?? 0,
      }))
    : [];
  const trendData = chart
    ? chart.trend.map((p) => ({
        date: formatter.dateTime(new Date(`${p.day}T12:00:00Z`), {
          month: "short",
          day: "numeric",
        }),
        created: p.created,
        resolved: p.resolved,
      }))
    : [];

  // Charts are noise on an empty system — only show once tickets exist.
  const showCharts = !strictTech && chart !== null && (stats?.total ?? 0) > 0;
  const showCsat = !!csat && csat.breakdown.total > 0;

  // ── Widgets ────────────────────────────────────────────────────────────
  // Every widget this person may have, its content already rendered here on the
  // server. WHICH ones appear, where and how big is their saved layout (or the
  // default); <DashboardGrid> draws that. A widget with nothing to show right now
  // (a clean SLA day, no held replies…) is marked `empty` rather than left out:
  // the grid hides it and closes the gap while viewing, but it can still be
  // moved or hidden while customizing.
  const { layout } = await layoutPromise;
  const lazyData = new Map(await lazyPromise);
  const viewer = viewerOf(user);

  const statDefs: Partial<
    Record<
      WidgetId,
      {
        title: string;
        value: number | null;
        href: string;
        icon: typeof TicketIcon;
        tone: keyof typeof STAT_TONES;
        accent?: "warning";
      }
    >
  > = {
    "stat.total": { title: t("statTotal"), value: stats?.total ?? null, href: "/admin/tickets?view=all", icon: TicketIcon, tone: "blue" },
    "stat.open": { title: t("statOpenTickets"), value: stats?.openTickets ?? null, href: "/admin/tickets?status=open,in_progress", icon: CircleDot, tone: "amber" },
    "stat.unassigned": {
      title: t("statUnassigned"),
      value: stats?.unassigned ?? null,
      href: "/admin/tickets?status=open&assignee=unassigned",
      icon: UserPlus,
      tone: "rose",
      accent: stats?.unassigned != null && stats.unassigned > 0 ? "warning" : undefined,
    },
    "stat.awaiting": { title: t("statAwaiting"), value: stats?.awaiting ?? null, href: "/admin/tickets?status=awaiting_customer_confirmation", icon: Hourglass, tone: "purple" },
    "stat.onHold": { title: t("statOnHold"), value: stats?.onHold ?? null, href: "/admin/tickets?status=on_hold", icon: PauseCircle, tone: "slate" },
    "stat.resolved": { title: t("statResolved"), value: stats?.resolved ?? null, href: "/admin/tickets?status=resolved", icon: CircleCheck, tone: "emerald" },
  };

  const slotFor = (id: WidgetId): DashboardSlot => {
    switch (id) {
      case "myQueue":
        return {
          kind: "node", id, title: t("myQueue.title"),
          empty: !(showMyQueue && myQueue),
          node: showMyQueue && myQueue ? <MyQueue data={myQueue} userId={user.id} t={t} /> : null,
        };
      case "sla":
        return {
          kind: "node", id, title: t("slaBoard.title"),
          empty: !(showSlaBoard && slaBoard),
          node: showSlaBoard && slaBoard ? <SlaBoard data={slaBoard} t={t} formatter={formatter} /> : null,
        };
      case "escalations":
        return {
          kind: "node", id, title: t("escalations.title"),
          empty: !(showEscalations && escalations),
          node:
            showEscalations && escalations ? (
              <EscalationsBoard data={escalations} t={t} formatter={formatter} reasonLabels={escalationReasonLabels} />
            ) : null,
        };
      case "triage":
        return {
          kind: "node", id, title: t("triage.title"),
          empty: !(showTriage && triage),
          node: showTriage && triage ? <TriagePanel data={triage} t={t} /> : null,
        };
      case "planWatch":
        return {
          kind: "node", id, title: t("planWatch.title"),
          empty: !(showPlanWatch && planWatch),
          node: showPlanWatch && planWatch ? <PlanWatchPanel data={planWatch} t={t} /> : null,
        };
      case "csat":
        return {
          kind: "node", id, title: t("csatTitle"),
          empty: !showCsat,
          node: showCsat && csat ? (
            <section aria-label={t("csatLabel")} className="flex flex-col">
          <Card className="flex-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("csatTitle")}</CardTitle>
              <CardDescription>
                {t("csatSubtitle", { total: csat.breakdown.total })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-semibold tabular-nums">
                    {Math.round((csat.breakdown.positiveRate ?? 0) * 100)}%
                  </span>
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">
                    {t("csatPositive")}
                  </span>
                </div>
                <div className="ml-auto flex items-center gap-2 text-sm tabular-nums text-zinc-600 dark:text-zinc-300">
                  {(
                    [
                      { rating: "happy", count: csat.breakdown.happy },
                      { rating: "neutral", count: csat.breakdown.neutral },
                      { rating: "unhappy", count: csat.breakdown.unhappy },
                    ] as const
                  ).map((r) => (
                    <Link
                      key={r.rating}
                      href={csatTicketsHref(r.rating)}
                      title={t("csatViewTickets")}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <span aria-hidden="true">{CSAT_EMOJI[r.rating]}</span>
                      <span>{r.count}</span>
                    </Link>
                  ))}
                </div>
              </div>

              {/* Quality signals */}
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm border-t border-zinc-100 dark:border-zinc-800 pt-3">
                <span className="text-zinc-600 dark:text-zinc-300">
                  {t("csatFirstContact", {
                    rate:
                      csat.quality.firstContactRate !== null
                        ? Math.round(csat.quality.firstContactRate * 100)
                        : 0,
                  })}
                </span>
                <span className="text-zinc-600 dark:text-zinc-300">
                  {t("csatRework", {
                    rate:
                      csat.quality.reworkRate !== null
                        ? Math.round(csat.quality.reworkRate * 100)
                        : 0,
                  })}
                </span>
              </div>

              {/* Top technicians by feedback volume */}
              {csat.byTechnician.length > 0 ? (
                <ul className="space-y-1.5 text-sm border-t border-zinc-100 dark:border-zinc-800 pt-3">
                  {csat.byTechnician.map((tech) => (
                    <li
                      key={tech.technicianId ?? "unassigned"}
                      className="flex items-center gap-3"
                    >
                      <span className="truncate min-w-0 flex-1 text-zinc-700 dark:text-zinc-200">
                        {tech.technicianName ?? t("csatUnassigned")}
                      </span>
                      <span className="shrink-0 tabular-nums text-xs text-zinc-500 dark:text-zinc-400">
                        {(
                          [
                            { rating: "happy", count: tech.happy },
                            { rating: "neutral", count: tech.neutral },
                            { rating: "unhappy", count: tech.unhappy },
                          ] as const
                        ).map((r) => (
                          <Link
                            key={r.rating}
                            href={csatTicketsHref(r.rating, tech.technicianId)}
                            title={t("csatViewTickets")}
                            className="ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors first:ml-0 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          >
                            <span aria-hidden="true">{CSAT_EMOJI[r.rating]}</span>
                            <span>{r.count}</span>
                          </Link>
                        ))}
                      </span>
                      <span className="shrink-0 w-10 text-right tabular-nums font-medium">
                        {tech.positiveRate !== null
                          ? `${Math.round(tech.positiveRate * 100)}%`
                          : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>
        </section> ) : null,
        };
      case "chart.trend":
        return {
          kind: "chart", id, title: t("chartTrendTitle"),
          subtitle: t("chartTrendSubtitle", { days: TREND_DAYS }),
          empty: !showCharts,
          spec: {
            kind: "trend",
            series: [
              { key: "created", name: t("trendCreated"), tone: "blue" },
              { key: "resolved", name: t("trendResolved"), tone: "green" },
            ],
            data: trendData,
          },
        };
      case "chart.status":
        return {
          kind: "chart", id, title: t("chartStatusTitle"),
          empty: !showCharts,
          spec: { kind: "category", palette: "status", data: statusData },
        };
      case "chart.priority":
        return {
          kind: "chart", id, title: t("chartPriorityTitle"),
          subtitle: t("chartPrioritySubtitle"),
          empty: !showCharts,
          spec: { kind: "category", palette: "priority", data: priorityData },
        };
      default: {
        const lazyDef = getWidget(id);
        if (lazyDef?.lazy && lazyDef.metricKey) {
          const data = lazyData.get(id) ?? null;
          return {
            kind: "chart", id,
            title: t(`metrics.${lazyDef.metricKey}.title`),
            subtitle: data?.subtitle,
            spec: data?.spec ?? null,
          };
        }
        const s = statDefs[id];
        return {
          kind: "node", id, title: s?.title ?? id,
          empty: !s || s.value === null,
          node:
            s && s.value !== null ? (
              <StatCard label={s.title} value={s.value} href={s.href} icon={s.icon} tone={s.tone} accent={s.accent} />
            ) : null,
        };
      }
    }
  };

  const widgets = availableWidgets(viewer);
  const slots = widgets.map((w) => slotFor(w.id));

  return (
    <div className="space-y-6">
      {/* ── Welcome strip ───────────────────────────────────────── */}
      <header>
        <h1 className="text-2xl font-semibold mb-1">{t("welcome")}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t("rolesPrefix")} <span className="font-medium">{displayRoles}</span>
        </p>
      </header>

      <DashboardGrid
        initialLayout={layout}
        defaultLayout={defaultLayout(viewer)}
        slots={slots}
        catalog={widgets.map((w, i) => ({ id: w.id, group: w.group, title: slots[i].title }))}
        chartLabels={{
          empty: t("chart.empty"),
          name: t("chart.name"),
          value: t("chart.value"),
          date: t("chart.date"),
          other: t("metrics.other"),
          open: t("chart.open"),
          overdue: t("chart.overdue"),
          health: t("chart.health"),
          onTrack: t("chart.onTrack"),
          atRisk: t("chart.atRisk"),
          offTrack: t("chart.offTrack"),
        }}
      />
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────

type LandingT = Awaited<ReturnType<typeof getTranslations<"admin.landing">>>;
type Formatter = Awaited<ReturnType<typeof getFormatter>>;
type ChipTone = "info" | "warn" | "crit" | "escal";

function MyQueue({
  data,
  userId,
  t,
}: {
  data: MyQueueData;
  userId: string;
  t: LandingT;
}) {
  // Every chip is a slice of the viewer's own tickets. "Assigned to me" and
  // "Escalated to me" deep-link precisely; "Awaiting my reply" and "SLA
  // at-risk" have no dedicated list filter yet, so they land on the broader
  // assignee view — the count is the signal, the link gets you to your tickets.
  const base = `/admin/tickets?assignee=${userId}`;
  const chips: {
    key: string;
    label: string;
    value: number;
    href: string;
    tone: ChipTone;
  }[] = [
    { key: "assigned", label: t("myQueue.assigned"), value: data.counts.assigned, href: base, tone: "info" },
    { key: "awaiting", label: t("myQueue.awaiting"), value: data.counts.awaiting, href: base, tone: "warn" },
    { key: "atRisk", label: t("myQueue.atRisk"), value: data.counts.atRisk, href: base, tone: "crit" },
    { key: "escalated", label: t("myQueue.escalated"), value: data.counts.escalated, href: `${base}&escalated=1`, tone: "escal" },
  ];

  return (
    <section
      aria-label={t("myQueue.title")}
      className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
            <Inbox className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold leading-tight">
              {t("myQueue.title")}
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("myQueue.scope")}
            </p>
          </div>
        </div>
        <Link
          href={base}
          className="shrink-0 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          {t("myQueue.viewAll")}
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
        {chips.map((c) => (
          <ChipLink
            key={c.key}
            label={c.label}
            value={c.value}
            href={c.href}
            tone={c.tone}
          />
        ))}
      </div>

      <div className="px-4 pb-4">
        {data.items.length === 0 ? (
          <div className="rounded-md border border-dashed border-zinc-200 py-8 text-center dark:border-zinc-800">
            <p className="text-sm font-medium text-green-600 dark:text-green-400">
              {t("myQueue.caughtUp")}
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {t("myQueue.caughtUpHint")}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {data.items.map((it) => (
              <li key={it.id}>
                <Link
                  href={`/admin/tickets/${it.id}`}
                  className="group flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                >
                  <PriorityBadge priority={it.priority} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {it.isEscalated ? <EscalatedBadge /> : null}
                      <span className="truncate text-sm font-medium">
                        {it.subject}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="font-mono">{it.ticketNumber}</span>
                      {it.organizationName ? (
                        <span> · {it.organizationName}</span>
                      ) : null}
                    </div>
                  </div>
                  <QueuePill item={it} t={t} />
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-zinc-300 group-hover:text-zinc-400 dark:text-zinc-600"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ChipLink({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: number;
  href: string;
  tone: ChipTone;
}) {
  const accentBorder: Record<ChipTone, string> = {
    info: "border-l-blue-500",
    warn: "border-l-amber-500",
    crit: "border-l-red-500",
    escal: "border-l-violet-500",
  };
  // Draw the eye to non-zero severity counts; a zero stays neutral.
  const valueClass =
    value === 0
      ? "text-zinc-900 dark:text-zinc-50"
      : tone === "crit"
        ? "text-red-600 dark:text-red-400"
        : tone === "warn"
          ? "text-amber-600 dark:text-amber-400"
          : tone === "escal"
            ? "text-violet-600 dark:text-violet-400"
            : "text-zinc-900 dark:text-zinc-50";
  return (
    <Link
      href={href}
      className={cn(
        "rounded-lg border border-l-[3px] border-zinc-200 bg-white px-3 py-2.5 transition-colors hover:border-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700",
        accentBorder[tone],
      )}
    >
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className={cn("mt-0.5 text-2xl font-semibold tabular-nums", valueClass)}>
        {value}
      </p>
    </Link>
  );
}

function QueuePill({
  item,
  t,
}: {
  item: MyQueueData["items"][number];
  t: LandingT;
}) {
  // One pill, most-urgent-wins: a breached SLA outranks an at-risk one, which
  // outranks "the customer is waiting on you".
  let tone: "crit" | "warn" | "info" | null = null;
  let label = "";
  if (item.slaBreachedAt) {
    tone = "crit";
    label = t("myQueue.pill.overdue");
  } else if (item.slaWarning80At) {
    tone = "warn";
    label = t("myQueue.pill.dueSoon");
  } else if (item.awaitingReply) {
    tone = "info";
    label = t("myQueue.pill.yourReply");
  }
  if (!tone) return null;

  const toneClass = {
    crit: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
    warn: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    info: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  }[tone];
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
        toneClass,
      )}
    >
      {label}
    </span>
  );
}

function SlaBoard({
  data,
  t,
  formatter,
}: {
  data: SlaBoardData;
  t: LandingT;
  formatter: Formatter;
}) {
  const now = new Date();
  return (
    <section
      aria-label={t("slaBoard.title")}
      className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400">
            <AlarmClock className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold leading-tight">
              {t("slaBoard.title")}
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("slaBoard.subtitle")}
            </p>
          </div>
        </div>
        <Link
          href={`/admin/tickets?sla=${data.counts.breached > 0 ? "breached" : "at_risk"}`}
          className="shrink-0 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          {data.counts.breached > 0
            ? t("slaBoard.viewBreached")
            : t("slaBoard.viewAtRisk")}
        </Link>
      </div>

      {/* The counts are links: each opens the tickets list filtered to exactly
          the tickets it counts (same predicate, lib/tickets/ticket-filter-
          conditions.ts). Only this card's 6 rows are previewed here. */}
      <div className="flex flex-wrap gap-2 px-4 pt-3">
        <SlaCountChip
          count={data.counts.breached}
          label={t("slaBoard.breached")}
          href="/admin/tickets?sla=breached"
          tone="red"
        />
        <SlaCountChip
          count={data.counts.atRisk}
          label={t("slaBoard.atRisk")}
          href="/admin/tickets?sla=at_risk"
          tone="amber"
        />
      </div>

      <div className="px-4 pb-4 pt-2">
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {data.items.map((it) => (
            <li key={it.id}>
              <Link
                href={`/admin/tickets/${it.id}`}
                className="group flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              >
                <PriorityBadge priority={it.priority} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {it.isEscalated ? <EscalatedBadge /> : null}
                    <span className="truncate text-sm font-medium">
                      {it.subject}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="font-mono">{it.ticketNumber}</span>
                    {it.organizationAbbreviation ? (
                      <span> · {it.organizationAbbreviation}</span>
                    ) : null}
                    <span> · {it.assignedToName ?? t("slaBoard.unassigned")}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {it.dueAt ? (
                    <span className="hidden text-xs tabular-nums text-zinc-500 dark:text-zinc-400 sm:inline">
                      {formatter.relativeTime(it.dueAt, { now })}
                    </span>
                  ) : null}
                  <StatePill state={it.state} t={t} />
                </div>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-zinc-300 group-hover:text-zinc-400 dark:text-zinc-600"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const SLA_CHIP_TONES = {
  red: {
    box: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40",
    hover: "hover:bg-red-100 dark:hover:bg-red-950/60",
    count: "text-red-600 dark:text-red-400",
    label: "text-red-700/80 dark:text-red-300/80",
  },
  amber: {
    box: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40",
    hover: "hover:bg-amber-100 dark:hover:bg-amber-950/60",
    count: "text-amber-600 dark:text-amber-400",
    label: "text-amber-700/80 dark:text-amber-300/80",
  },
} as const;

/** A count chip that opens the matching tickets. A zero count stays plain: the
 *  list behind it would be empty, so there is nothing to click through to. */
function SlaCountChip({
  count,
  label,
  href,
  tone,
}: {
  count: number;
  label: string;
  href: string;
  tone: keyof typeof SLA_CHIP_TONES;
}) {
  const c = SLA_CHIP_TONES[tone];
  const body = (
    <>
      <span className={cn("text-base font-semibold tabular-nums", c.count)}>
        {count}
      </span>
      <span className={cn("text-xs", c.label)}>{label}</span>
    </>
  );
  const base = cn(
    "inline-flex items-baseline gap-1.5 rounded-md border px-2.5 py-1",
    c.box,
  );
  return count > 0 ? (
    <Link href={href} className={cn(base, "transition-colors", c.hover)}>
      {body}
    </Link>
  ) : (
    <span className={base}>{body}</span>
  );
}

function StatePill({
  state,
  t,
}: {
  state: "breached" | "at_risk";
  t: LandingT;
}) {
  const isBreached = state === "breached";
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
        isBreached
          ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
          : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
      )}
    >
      {isBreached ? t("slaBoard.pill.overdue") : t("slaBoard.pill.dueSoon")}
    </span>
  );
}

function EscalationsBoard({
  data,
  t,
  formatter,
  reasonLabels,
}: {
  data: EscalationsBoardData;
  t: LandingT;
  formatter: Formatter;
  reasonLabels: Record<string, string>;
}) {
  const now = new Date();
  return (
    <section
      aria-label={t("escalations.title")}
      className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-400">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold leading-tight">
              {t("escalations.title")}
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("escalations.subtitle")}
            </p>
          </div>
        </div>
        <Link
          href="/admin/tickets?escalated=1"
          className="shrink-0 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          {t("escalations.viewAll")}
        </Link>
      </div>

      <div className="flex flex-wrap gap-2 px-4 pt-3">
        <span className="inline-flex items-baseline gap-1.5 rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 dark:border-violet-900 dark:bg-violet-950/40">
          <span className="text-base font-semibold tabular-nums text-violet-600 dark:text-violet-400">
            {data.total}
          </span>
          <span className="text-xs text-violet-700/80 dark:text-violet-300/80">
            {t("escalations.open")}
          </span>
        </span>
      </div>

      <div className="px-4 pb-4 pt-2">
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {data.items.map((it) => (
            <li key={it.id}>
              <Link
                href={`/admin/tickets/${it.id}`}
                className="group flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              >
                <PriorityBadge priority={it.priority} />
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {it.subject}
                  </span>
                  <div className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="font-mono">{it.ticketNumber}</span>
                    {it.organizationAbbreviation ? (
                      <span> · {it.organizationAbbreviation}</span>
                    ) : null}
                    {it.escalationTargetRole ? (
                      <span>
                        {" · "}
                        {t("escalations.escalatedTo")} {it.escalationTargetRole}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {it.escalationReason && reasonLabels[it.escalationReason] ? (
                    <span className="hidden rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300 sm:inline">
                      {reasonLabels[it.escalationReason]}
                    </span>
                  ) : null}
                  {it.escalatedAt ? (
                    <span className="hidden text-xs tabular-nums text-zinc-500 dark:text-zinc-400 sm:inline">
                      {formatter.relativeTime(it.escalatedAt, { now })}
                    </span>
                  ) : null}
                </div>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-zinc-300 group-hover:text-zinc-400 dark:text-zinc-600"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function TriagePanel({ data, t }: { data: TriagePanelData; t: LandingT }) {
  return (
    <section
      aria-label={t("triage.title")}
      className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-center gap-2.5 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
          <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-base font-semibold leading-tight">
            {t("triage.title")}
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("triage.subtitle")}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 p-4 sm:flex-row">
        {data.held !== null ? (
          <TriageTile
            href="/admin/moderation"
            value={data.held}
            label={t("triage.held")}
            hint={t("triage.heldHint")}
          />
        ) : null}
        {data.pendingParticipants !== null ? (
          <TriageTile
            href="/admin/moderation"
            value={data.pendingParticipants}
            label={t("triage.pendingParticipants")}
            hint={t("triage.pendingParticipantsHint")}
          />
        ) : null}
        {data.unverified !== null ? (
          <TriageTile
            href="/admin/org-triage"
            value={data.unverified}
            label={t("triage.unverified")}
            hint={t("triage.unverifiedHint")}
          />
        ) : null}
      </div>
    </section>
  );
}

function TriageTile({
  href,
  value,
  label,
  hint,
}: {
  href: string;
  value: number;
  label: string;
  hint: string;
}) {
  const active = value > 0;
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border px-4 py-3 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 sm:flex-1",
        active
          ? "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30"
          : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700",
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {label}
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
      </div>
      <span
        className={cn(
          "text-2xl font-semibold tabular-nums",
          active
            ? "text-amber-600 dark:text-amber-400"
            : "text-zinc-400 dark:text-zinc-600",
        )}
      >
        {value}
      </span>
    </Link>
  );
}

// Minutes → "Xh" (integer, else one decimal) — mirrors the org usage UI so
// both surfaces present contracted time the same way.
function hoursLabel(minutes: number): string {
  const h = minutes / 60;
  const s = Number.isInteger(h) ? String(h) : h.toFixed(1);
  return `${s}h`;
}

function PlanWatchPanel({
  data,
  t,
}: {
  data: PlanWatchData;
  t: LandingT;
}) {
  return (
    <section
      aria-label={t("planWatch.title")}
      className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
            <Gauge className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold leading-tight">
              {t("planWatch.title")}
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("planWatch.subtitle")}
            </p>
          </div>
        </div>
        <Link
          href="/admin/organizations"
          className="shrink-0 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          {t("planWatch.viewAll")}
        </Link>
      </div>

      <ul className="divide-y divide-zinc-100 px-4 dark:divide-zinc-800">
        {data.items.map((org) => {
          const over = org.state === "over";
          const remaining = over
            ? t("planWatch.over", { hours: hoursLabel(-org.balanceMinutes) })
            : t("planWatch.left", { hours: hoursLabel(org.balanceMinutes) });
          return (
            <li key={org.id}>
              <Link
                href={`/admin/organizations/${org.id}`}
                className="group block rounded-md px-2 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium">
                    {org.name}
                    <span className="ml-1.5 font-mono text-xs text-zinc-400 dark:text-zinc-500">
                      {org.abbreviation}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-xs font-medium tabular-nums",
                      over
                        ? "text-red-600 dark:text-red-400"
                        : "text-amber-600 dark:text-amber-400",
                    )}
                  >
                    {t("planWatch.used", { pct: org.usedPct })} · {remaining}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      over ? "bg-red-500" : "bg-amber-500",
                    )}
                    style={{ width: `${Math.min(org.usedPct, 100)}%` }}
                  />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Colored icon chip tones for the quick-stat cards. Mirrors the token style
// used by the customer portal's StatCard so both dashboards read as one system.
const STAT_TONES = {
  blue: "text-blue-700 bg-blue-50 dark:text-blue-300 dark:bg-blue-950/40",
  amber: "text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40",
  rose: "text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-950/40",
  purple:
    "text-purple-700 bg-purple-50 dark:text-purple-300 dark:bg-purple-950/40",
  slate: "text-slate-700 bg-slate-100 dark:text-slate-300 dark:bg-slate-800",
  emerald:
    "text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40",
} as const;

function StatCard({
  label,
  value,
  href,
  icon: Icon,
  tone,
  accent,
}: {
  label: string;
  /** `null` = caller doesn't have permission for this stat; render an
   *  inert placeholder so the grid stays aligned. */
  value: number | null;
  href: string;
  icon: typeof TicketIcon;
  tone: keyof typeof STAT_TONES;
  accent?: "warning";
}) {
  if (value === null) {
    return (
      <div
        aria-hidden="true"
        className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 px-4 py-3 opacity-40"
      />
    );
  }
  return (
    <Link
      href={href}
      className={cn(
        "block rounded-lg border bg-white dark:bg-zinc-900 px-4 py-3 hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500",
        accent === "warning" && value > 0
          ? "border-amber-300 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30"
          : "border-zinc-200 dark:border-zinc-800",
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {label}
        </p>
        <span
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-md",
            STAT_TONES[tone],
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        {value}
      </p>
    </Link>
  );
}
