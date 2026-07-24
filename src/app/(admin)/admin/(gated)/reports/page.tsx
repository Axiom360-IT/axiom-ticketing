import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ExportMenu } from "@/components/shared/export-menu";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CsatTrendChart,
  StageBar,
  StatusPie,
  TechLoadBar,
} from "@/components/reports/charts";
import {
  loadCsatStats,
  loadProcurementSpend,
  loadTicketHealth,
  parseReportRange,
} from "@/lib/reports/queries";
import { UrlDateRange } from "@/components/ui/url-date-range";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (
    !(await can(user, "reports.view", { type: "global" }, productionContext))
  ) {
    redirect("/admin");
  }

  const sp = await searchParams;
  const range = parseReportRange(sp.from, sp.to);
  const exportParams: Record<string, string> = {};
  if (sp.from?.trim()) exportParams.from = sp.from.trim();
  if (sp.to?.trim()) exportParams.to = sp.to.trim();

  const [tickets, procurement, csat, canExport] = await Promise.all([
    loadTicketHealth(range),
    loadProcurementSpend(range),
    loadCsatStats(range),
    can(user, "reports.export", { type: "global" }, productionContext),
  ]);

  const t = await getTranslations("reports");
  const tStatus = await getTranslations("tickets.status");
  const tType = await getTranslations("procurement.type");
  const tProcStatus = await getTranslations("procurement.status");
  const formatter = await getFormatter();

  function statusName(key: string): string {
    if (key === "open" || key === "in_progress" || key === "resolved" || key === "closed") {
      return tStatus(key);
    }
    return key;
  }

  function streamName(key: string): string {
    if (key === "internal") return t("stream.internal");
    if (key === "external") return t("stream.external");
    return key;
  }

  function fmtCurrency(n: number): string {
    return formatter.number(n, { style: "currency", currency: "USD" });
  }

  function fmtPercent(rate: number | null): string | null {
    if (rate === null) return null;
    return `${Math.round(rate * 100)}`;
  }

  const csatTrend = csat.monthlyTrend.map((p) => ({
    month: formatter.dateTime(new Date(`${p.month}-01T12:00:00Z`), {
      month: "short",
    }),
    positive: p.positiveRate !== null ? Math.round(p.positiveRate * 100) : null,
    total: p.total,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">{t("page.title")}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {range
              ? t("page.subtitlePeriod", {
                  from: sp.from ?? "…",
                  to: sp.to ?? "…",
                })
              : t("page.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <UrlDateRange
            fromValue={sp.from ?? ""}
            toValue={sp.to ?? ""}
            fromLabel={t("filters.from")}
            toLabel={t("filters.to")}
          />
          {canExport ? (
            <ExportMenu baseHref="/api/reports/export" params={exportParams} />
          ) : null}
        </div>
      </div>

      {/* Ticket health */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("ticketHealth.title")}</h2>

        <div className="grid sm:grid-cols-3 gap-4">
          {range ? (
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t("ticketHealth.periodLabel")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">
                  {formatter.number(tickets.totalsByWindow.allTime)}
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-xs text-zinc-500 dark:text-zinc-400">
                    {t("ticketHealth.weekLabel")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold">
                    {formatter.number(tickets.totalsByWindow.week)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-xs text-zinc-500 dark:text-zinc-400">
                    {t("ticketHealth.monthLabel")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold">
                    {formatter.number(tickets.totalsByWindow.month)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-xs text-zinc-500 dark:text-zinc-400">
                    {t("ticketHealth.allTimeLabel")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold">
                    {formatter.number(tickets.totalsByWindow.allTime)}
                  </p>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                {t("ticketHealth.byStatusTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <StatusPie
                data={tickets.byStatus.map((r) => ({
                  name: statusName(r.status),
                  value: r.count,
                }))}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                {t("ticketHealth.byStreamTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <StatusPie
                data={tickets.byStream.map((r) => ({
                  name: streamName(r.stream),
                  value: r.count,
                }))}
              />
            </CardContent>
          </Card>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title={t("ticketHealth.averageResolutionTitle")}
            value={
              tickets.averageResolutionMinutes !== null
                ? t("ticketHealth.averageResolutionMinutes", {
                    minutes: tickets.averageResolutionMinutes,
                  })
                : t("ticketHealth.averageResolutionEmpty")
            }
          />
          <MetricCard
            title={t("ticketHealth.csatTitle")}
            value={
              tickets.csatRate.rate !== null
                ? t("ticketHealth.csatRate", {
                    rate: fmtPercent(tickets.csatRate.rate) ?? "0",
                  })
                : t("ticketHealth.csatEmpty")
            }
            hint={t("ticketHealth.csatBreakdown", {
              satisfied: tickets.csatRate.satisfied,
              unsatisfied: tickets.csatRate.unsatisfied,
            })}
          />
          <MetricCard
            title={t("ticketHealth.escalationTitle")}
            value={
              tickets.escalationRate !== null
                ? t("ticketHealth.escalationRate", {
                    rate: fmtPercent(tickets.escalationRate) ?? "0",
                  })
                : "—"
            }
          />
          <MetricCard
            title={t("ticketHealth.slaTitle")}
            value={
              tickets.slaComplianceRate !== null
                ? t("ticketHealth.slaRate", {
                    rate: fmtPercent(tickets.slaComplianceRate) ?? "0",
                  })
                : "—"
            }
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {t("ticketHealth.techLoadTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tickets.techLoad.length === 0 ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {t("ticketHealth.techLoadEmpty")}
              </p>
            ) : (
              <TechLoadBar
                data={tickets.techLoad.map((u) => ({
                  name: u.name,
                  assigned: u.assigned,
                  resolved: u.resolved,
                }))}
                assignedLabel={t("ticketHealth.techLoadAssigned")}
                resolvedLabel={t("ticketHealth.techLoadResolved")}
              />
            )}
          </CardContent>
        </Card>
      </section>

      {/* Customer satisfaction (emoji CSAT) */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("csat.title")}</h2>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title={t("csat.positiveTitle")}
            value={
              csat.breakdown.positiveRate !== null
                ? t("csat.positiveRate", {
                    rate: fmtPercent(csat.breakdown.positiveRate) ?? "0",
                  })
                : t("csat.empty")
            }
            hint={t("csat.totalResponses", { total: csat.breakdown.total })}
          />
          <MetricCard
            title={t("csat.happyTitle")}
            value={formatter.number(csat.breakdown.happy)}
          />
          <MetricCard
            title={t("csat.neutralTitle")}
            value={formatter.number(csat.breakdown.neutral)}
          />
          <MetricCard
            title={t("csat.unhappyTitle")}
            value={formatter.number(csat.breakdown.unhappy)}
          />
        </div>

        {/* Quality signals: first-contact resolution + rework */}
        <div className="grid sm:grid-cols-2 gap-4">
          <MetricCard
            title={t("csat.firstContactTitle")}
            value={
              csat.quality.firstContactRate !== null
                ? t("csat.firstContactValue", {
                    rate: fmtPercent(csat.quality.firstContactRate) ?? "0",
                  })
                : t("csat.empty")
            }
            hint={t("csat.firstContactHint")}
          />
          <MetricCard
            title={t("csat.reworkTitle")}
            value={
              csat.quality.reworkRate !== null
                ? t("csat.reworkValue", {
                    rate: fmtPercent(csat.quality.reworkRate) ?? "0",
                  })
                : t("csat.empty")
            }
            hint={t("csat.reworkHint")}
          />
        </div>

        {/* Monthly positive-rate trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("csat.trendTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {csatTrend.length === 0 ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {t("csat.empty")}
              </p>
            ) : (
              <CsatTrendChart
                data={csatTrend}
                label={t("csat.positiveTitle")}
              />
            )}
          </CardContent>
        </Card>

        {/* By technician + by organization */}
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                {t("csat.byTechnicianTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CsatRatingTable
                firstColLabel={t("csat.techColTechnician")}
                positiveLabel={t("csat.techColPositive")}
                emptyLabel={t("csat.empty")}
                happyLabel={t("csat.happyTitle")}
                neutralLabel={t("csat.neutralTitle")}
                unhappyLabel={t("csat.unhappyTitle")}
                rows={csat.byTechnician.map((r) => ({
                  key: r.technicianId ?? "unassigned",
                  name: r.technicianName ?? t("csat.unassigned"),
                  happy: r.happy,
                  neutral: r.neutral,
                  unhappy: r.unhappy,
                  positiveRate: r.positiveRate,
                }))}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                {t("csat.byOrganizationTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CsatRatingTable
                firstColLabel={t("csat.orgColOrganization")}
                positiveLabel={t("csat.techColPositive")}
                emptyLabel={t("csat.empty")}
                happyLabel={t("csat.happyTitle")}
                neutralLabel={t("csat.neutralTitle")}
                unhappyLabel={t("csat.unhappyTitle")}
                rows={csat.byOrganization.map((r) => ({
                  key: r.organizationId ?? "none",
                  name: r.organizationName ?? t("csat.noOrganization"),
                  happy: r.happy,
                  neutral: r.neutral,
                  unhappy: r.unhappy,
                  positiveRate: r.positiveRate,
                }))}
              />
            </CardContent>
          </Card>
        </div>

        {/* Recent comments */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {t("csat.recentCommentsTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {csat.recentComments.length === 0 ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {t("csat.recentCommentsEmpty")}
              </p>
            ) : (
              <ul className="space-y-3">
                {csat.recentComments.map((c) => (
                  <li
                    key={c.id}
                    className="border-b border-zinc-100 dark:border-zinc-800 pb-2 last:border-0 last:pb-0"
                  >
                    <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      <span aria-hidden="true">{ratingEmoji(c.rating)}</span>
                      <span className="font-mono">{c.ticketNumber}</span>
                      {c.technicianName ? (
                        <span className="truncate">· {c.technicianName}</span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-sm text-zinc-800 dark:text-zinc-200 break-words">
                      {c.comment}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Procurement spend */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("procurement.title")}</h2>

        <div className="grid sm:grid-cols-3 gap-4">
          {range ? (
            <MetricCard
              title={t("procurement.periodLabel")}
              value={fmtCurrency(procurement.totalsByWindow.year)}
            />
          ) : (
            <>
              <MetricCard
                title={t("procurement.monthLabel")}
                value={fmtCurrency(procurement.totalsByWindow.month)}
              />
              <MetricCard
                title={t("procurement.quarterLabel")}
                value={fmtCurrency(procurement.totalsByWindow.quarter)}
              />
              <MetricCard
                title={t("procurement.yearLabel")}
                value={fmtCurrency(procurement.totalsByWindow.year)}
              />
            </>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                {t("procurement.byTypeTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <StatusPie
                data={procurement.byType.map((r) => ({
                  name:
                    r.type === "hardware" || r.type === "software"
                      ? tType(r.type)
                      : r.type,
                  value: r.total,
                }))}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                {t("procurement.byStageTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <StageBar
                data={procurement.byStatus.map((r) => ({
                  name:
                    r.status === "pending_coordinator_approval" ||
                    r.status === "pending_admin_approval" ||
                    r.status === "approved" ||
                    r.status === "rejected" ||
                    r.status === "purchased" ||
                    r.status === "delivered"
                      ? tProcStatus(r.status)
                      : r.status,
                  total: r.total,
                }))}
              />
            </CardContent>
          </Card>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                {t("procurement.topItemsTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {procurement.topItems.length === 0 ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t("procurement.topItemsEmpty")}
                </p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {procurement.topItems.map((i) => (
                    <li
                      key={i.itemName}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <span className="truncate min-w-0 flex-1">{i.itemName}</span>
                      <span className="font-mono text-xs shrink-0">
                        {fmtCurrency(i.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                {t("procurement.pendingTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xl font-semibold">
                {t("procurement.pendingValue", {
                  count: procurement.pendingApprovals.count,
                  total: fmtCurrency(procurement.pendingApprovals.total),
                })}
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

function ratingEmoji(rating: string): string {
  if (rating === "happy") return "😊";
  if (rating === "neutral") return "😐";
  if (rating === "unhappy") return "☹️";
  return "•";
}

type CsatTableRow = {
  key: string;
  name: string;
  happy: number;
  neutral: number;
  unhappy: number;
  positiveRate: number | null;
};

function CsatRatingTable({
  rows,
  firstColLabel,
  positiveLabel,
  emptyLabel,
  happyLabel,
  neutralLabel,
  unhappyLabel,
}: {
  rows: CsatTableRow[];
  firstColLabel: string;
  positiveLabel: string;
  emptyLabel: string;
  happyLabel: string;
  neutralLabel: string;
  unhappyLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{emptyLabel}</p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400">
            <th className="py-1 pr-2 font-medium">{firstColLabel}</th>
            <th
              className="py-1 px-2 font-medium text-center"
              aria-label={happyLabel}
            >
              {"😊"}
            </th>
            <th
              className="py-1 px-2 font-medium text-center"
              aria-label={neutralLabel}
            >
              {"😐"}
            </th>
            <th
              className="py-1 px-2 font-medium text-center"
              aria-label={unhappyLabel}
            >
              {"☹️"}
            </th>
            <th className="py-1 pl-2 font-medium text-right">{positiveLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.key}
              className="border-t border-zinc-100 dark:border-zinc-800"
            >
              <td className="py-1.5 pr-2 truncate max-w-[12rem]">{r.name}</td>
              <td className="py-1.5 px-2 text-center tabular-nums">
                {r.happy}
              </td>
              <td className="py-1.5 px-2 text-center tabular-nums">
                {r.neutral}
              </td>
              <td className="py-1.5 px-2 text-center tabular-nums">
                {r.unhappy}
              </td>
              <td className="py-1.5 pl-2 text-right tabular-nums font-medium">
                {r.positiveRate !== null
                  ? `${Math.round(r.positiveRate * 100)}%`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs text-zinc-500 dark:text-zinc-400">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xl font-semibold">{value}</p>
        {hint ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            {hint}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
