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
  Inbox,
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
  PriorityBar,
  StatusDonut,
  TrendLineChart,
} from "@/components/dashboard/charts";
import {
  EscalatedBadge,
  PriorityBadge,
} from "@/components/tickets/badges";
import { isStrictTechnician } from "@/lib/auth/can";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema/tickets";
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
import { cn } from "@/lib/utils";
import type { Permission } from "@/lib/auth/permissions";

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

  const [total, open, unassigned, resolved] = await Promise.all([
    canTickets
      ? db.select({ value: count() }).from(tickets).where(notDeleted)
      : Promise.resolve(null),
    canTickets
      ? db
          .select({ value: count() })
          .from(tickets)
          .where(and(inArray(tickets.status, ["open", "in_progress"]), notDeleted))
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

  return (
    <div className="space-y-8">
      {/* ── Welcome strip ───────────────────────────────────────── */}
      <header>
        <h1 className="text-2xl font-semibold mb-1">{t("welcome")}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t("rolesPrefix")} <span className="font-medium">{displayRoles}</span>
        </p>
      </header>

      {/* ── My Queue (personal, role-aware work surface) ────────── */}
      {showMyQueue && myQueue ? (
        <MyQueue data={myQueue} userId={user.id} t={t} />
      ) : null}

      {/* ── SLA deadlines (oversight; hidden when nothing at risk) ─ */}
      {showSlaBoard && slaBoard ? (
        <SlaBoard data={slaBoard} t={t} formatter={formatter} />
      ) : null}

      {/* ── Open escalations (oversight; hidden when none open) ──── */}
      {showEscalations && escalations ? (
        <EscalationsBoard
          data={escalations}
          t={t}
          formatter={formatter}
          reasonLabels={escalationReasonLabels}
        />
      ) : null}

      {/* ── Triage (held replies + unverified orgs; hidden at zero) ─ */}
      {showTriage && triage ? <TriagePanel data={triage} t={t} /> : null}

      {/* ── Monthly-plan watch (hidden when no org is low) ────────── */}
      {showPlanWatch && planWatch ? (
        <PlanWatchPanel data={planWatch} t={t} />
      ) : null}

      {/* ── Global health (hidden for strict Technicians) ───────── */}
      {!strictTech && stats ? (
        <section
          aria-label={t("quickStatsLabel")}
          className="grid grid-cols-2 gap-3 md:grid-cols-4"
        >
          <StatCard
            label={t("statTotal")}
            value={stats.total}
            href="/admin/tickets?view=all"
            icon={TicketIcon}
            tone="blue"
          />
          <StatCard
            label={t("statOpenTickets")}
            value={stats.openTickets}
            href="/admin/tickets?status=open,in_progress"
            icon={CircleDot}
            tone="amber"
          />
          <StatCard
            label={t("statUnassigned")}
            value={stats.unassigned}
            href="/admin/tickets?status=open&assignee=unassigned"
            icon={UserPlus}
            tone="rose"
            accent={
              stats.unassigned !== null && stats.unassigned > 0
                ? "warning"
                : undefined
            }
          />
          <StatCard
            label={t("statResolved")}
            value={stats.resolved}
            href="/admin/tickets?status=resolved"
            icon={CircleCheck}
            tone="emerald"
          />
        </section>
      ) : null}

      {/* ── Customer satisfaction (hidden until there's feedback) ── */}
      {csat && csat.breakdown.total > 0 ? (
        <section aria-label={t("csatLabel")}>
          <Card>
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
                <div className="ml-auto flex items-center gap-4 text-sm tabular-nums text-zinc-600 dark:text-zinc-300">
                  {[
                    { emoji: "😊", count: csat.breakdown.happy },
                    { emoji: "😐", count: csat.breakdown.neutral },
                    { emoji: "☹️", count: csat.breakdown.unhappy },
                  ].map((r) => (
                    <span key={r.emoji} className="inline-flex items-center gap-1">
                      <span aria-hidden="true">{r.emoji}</span>
                      <span>{r.count}</span>
                    </span>
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
                        {[
                          { emoji: "😊", count: tech.happy },
                          { emoji: "😐", count: tech.neutral },
                          { emoji: "☹️", count: tech.unhappy },
                        ].map((r) => (
                          <span
                            key={r.emoji}
                            className="inline-flex items-center gap-1 ml-2 first:ml-0"
                          >
                            <span aria-hidden="true">{r.emoji}</span>
                            <span>{r.count}</span>
                          </span>
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
        </section>
      ) : null}

      {/* ── Charts ──────────────────────────────────────────────── */}
      {showCharts ? (
        <section aria-label={t("chartsLabel")} className="grid gap-4 lg:grid-cols-2">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">{t("chartTrendTitle")}</CardTitle>
              <CardDescription>
                {t("chartTrendSubtitle", { days: TREND_DAYS })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TrendLineChart
                data={trendData}
                createdLabel={t("trendCreated")}
                resolvedLabel={t("trendResolved")}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("chartStatusTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <StatusDonut data={statusData} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("chartPriorityTitle")}
              </CardTitle>
              <CardDescription>{t("chartPrioritySubtitle")}</CardDescription>
            </CardHeader>
            <CardContent>
              <PriorityBar data={priorityData} />
            </CardContent>
          </Card>
        </section>
      ) : null}
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
          href="/admin/tickets"
          className="shrink-0 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          {t("slaBoard.viewAll")}
        </Link>
      </div>

      <div className="flex flex-wrap gap-2 px-4 pt-3">
        <span className="inline-flex items-baseline gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 dark:border-red-900 dark:bg-red-950/40">
          <span className="text-base font-semibold tabular-nums text-red-600 dark:text-red-400">
            {data.counts.breached}
          </span>
          <span className="text-xs text-red-700/80 dark:text-red-300/80">
            {t("slaBoard.breached")}
          </span>
        </span>
        <span className="inline-flex items-baseline gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 dark:border-amber-900 dark:bg-amber-950/40">
          <span className="text-base font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            {data.counts.atRisk}
          </span>
          <span className="text-xs text-amber-700/80 dark:text-amber-300/80">
            {t("slaBoard.atRisk")}
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
        "rounded-lg border bg-white dark:bg-zinc-900 px-4 py-3 hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500",
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
