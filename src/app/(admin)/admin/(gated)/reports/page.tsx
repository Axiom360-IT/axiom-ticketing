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
  StageBar,
  StatusPie,
  TechLoadBar,
} from "@/components/reports/charts";
import {
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

  const [tickets, procurement, canExport] = await Promise.all([
    loadTicketHealth(range),
    loadProcurementSpend(range),
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
