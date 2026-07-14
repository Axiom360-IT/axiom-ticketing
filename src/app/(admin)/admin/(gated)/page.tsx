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
  ClipboardList,
  GitBranch,
  History,
  Settings,
  Shield,
  ShoppingCart,
  Ticket,
  Users,
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
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema/tickets";
import { users } from "@/lib/db/schema/auth";
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

  const [total, open, unassigned, resolved, closed, activeUsers] =
    await Promise.all([
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
      canTickets
        ? db
            .select({ value: count() })
            .from(tickets)
            .where(and(eq(tickets.status, "closed"), notDeleted))
        : Promise.resolve(null),
      perms.has("users.view")
        ? db.select({ value: count() }).from(users).where(eq(users.isActive, true))
        : Promise.resolve(null),
    ]);

  return {
    total: one(total),
    openTickets: one(open),
    unassigned: one(unassigned),
    resolved: one(resolved),
    closed: one(closed),
    activeUsers: one(activeUsers),
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

  const MAIN_STATUSES = ["open", "in_progress", "resolved", "closed"];
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
  const formatter = await getFormatter();
  const [stats, chart] = await Promise.all([
    getStats(user.permissions),
    getChartData(user.permissions),
  ]);

  const displayRoles =
    user.roleNames.size > 0 ? [...user.roleNames].join(", ") : t("noRoles");

  // Shape chart data with translated labels (colours live in the chart
  // component, keyed by the stable `key`).
  const statusLabels: Record<string, string> = {
    open: tStatus("open"),
    in_progress: tStatus("in_progress"),
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

  const statusData = chart
    ? [
        ...["open", "in_progress", "resolved", "closed"].map((key) => ({
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
  const showCharts = chart !== null && (stats.total ?? 0) > 0;

  return (
    <div className="max-w-6xl space-y-8">
      {/* ── Welcome strip ───────────────────────────────────────── */}
      <header>
        <h1 className="text-2xl font-semibold mb-1">{t("welcome")}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t("rolesPrefix")} <span className="font-medium">{displayRoles}</span>
        </p>
      </header>

      {/* ── Quick stats ─────────────────────────────────────────── */}
      <section
        aria-label={t("quickStatsLabel")}
        className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6"
      >
        <StatCard
          label={t("statTotal")}
          value={stats.total}
          href="/admin/tickets?view=all"
        />
        <StatCard
          label={t("statOpenTickets")}
          value={stats.openTickets}
          href="/admin/tickets?status=open,in_progress"
        />
        <StatCard
          label={t("statUnassigned")}
          value={stats.unassigned}
          href="/admin/tickets?status=open&assignee=unassigned"
          accent={
            stats.unassigned !== null && stats.unassigned > 0 ? "warning" : undefined
          }
        />
        <StatCard
          label={t("statResolved")}
          value={stats.resolved}
          href="/admin/tickets?status=resolved"
        />
        <StatCard
          label={t("statClosed")}
          value={stats.closed}
          href="/admin/tickets?view=closed"
        />
        <StatCard
          label={t("statActiveUsers")}
          value={stats.activeUsers}
          href="/admin/users"
        />
      </section>

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

      {/* ── Section cards ───────────────────────────────────────── */}
      <section
        aria-label={t("sectionsLabel")}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
      >
        {user.permissions.has("tickets.view") ? (
          <SectionCard
            href="/admin/tickets"
            icon={Ticket}
            title={t("cardTicketsTitle")}
            description={t("cardTicketsDescription")}
          />
        ) : null}
        {user.permissions.has("procurement.view") ? (
          <SectionCard
            href="/admin/procurement"
            icon={ShoppingCart}
            title={t("cardProcurementTitle")}
            description={t("cardProcurementDescription")}
          />
        ) : null}
        {user.permissions.has("users.view") ? (
          <SectionCard
            href="/admin/users"
            icon={Users}
            title={t("cardUsersTitle")}
            description={t("cardUsersDescription")}
          />
        ) : null}
        {user.permissions.has("roles.view") ? (
          <SectionCard
            href="/admin/roles"
            icon={Shield}
            title={t("cardRolesTitle")}
            description={t("cardRolesDescription")}
          />
        ) : null}
        {user.permissions.has("users.view") ? (
          <SectionCard
            href="/admin/hierarchy"
            icon={GitBranch}
            title={t("cardHierarchyTitle")}
            description={t("cardHierarchyDescription")}
          />
        ) : null}
        {user.permissions.has("reports.view") ? (
          <SectionCard
            href="/admin/reports"
            icon={ClipboardList}
            title={t("cardReportsTitle")}
            description={t("cardReportsDescription")}
          />
        ) : null}
        {user.permissions.has("settings.view") ? (
          <SectionCard
            href="/admin/settings"
            icon={Settings}
            title={t("cardSettingsTitle")}
            description={t("cardSettingsDescription")}
          />
        ) : null}
        {user.permissions.has("audit.view") ? (
          <SectionCard
            href="/admin/audit"
            icon={History}
            title={t("cardAuditTitle")}
            description={t("cardAuditDescription")}
          />
        ) : null}
      </section>
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  href,
  accent,
}: {
  label: string;
  /** `null` = caller doesn't have permission for this stat; render an
   *  inert placeholder so the four-column grid stays aligned. */
  value: number | null;
  href: string;
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
      <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        {value}
      </p>
    </Link>
  );
}

function SectionCard({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: typeof Ticket;
  title: string;
  description: string;
}) {
  return (
    <Link href={href} className="group">
      <Card className="h-full transition-all group-hover:border-blue-300 group-hover:shadow-sm dark:group-hover:border-blue-700">
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="inline-flex w-9 h-9 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
              <Icon className="w-4 h-4" aria-hidden="true" />
            </span>
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
          <CardDescription className="mt-2">{description}</CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    </Link>
  );
}
