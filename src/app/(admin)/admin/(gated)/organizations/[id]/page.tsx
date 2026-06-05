import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddHoursControl } from "@/components/organizations/add-hours-control";
import { OrganizationForm } from "@/components/organizations/organization-form";
import { OrgUsageBreakdown } from "@/components/organizations/org-usage-breakdown";
import {
  getOrganizationDetail,
  getOrganizationUsage,
} from "@/app/actions/organizations";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";

function minutesToHoursString(minutes: number | null): string {
  if (minutes === null) return "";
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2);
}

function hoursDisplay(minutes: number | null): string {
  if (minutes === null) return "—";
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

export default async function EditOrganizationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (
    !(await can(user, "organizations.view", { type: "global" }, productionContext))
  ) {
    redirect("/admin");
  }

  const { id } = await params;
  const org = await getOrganizationDetail(id);
  if (!org) notFound();

  const canUpdate = await can(
    user,
    "organizations.update",
    { type: "global" },
    productionContext,
  );

  const usage = await getOrganizationUsage(id);

  const t = await getTranslations("organizations.edit");

  const includedMinutes = org.monthlyMinutesIncluded ?? 0;
  const balanceMinutes = org.monthlyMinutesBalance ?? 0;
  const usedMinutes = Math.max(0, includedMinutes - balanceMinutes);
  const usedPct =
    includedMinutes > 0
      ? Math.min(100, Math.round((usedMinutes / includedMinutes) * 100))
      : 0;
  const isNegative = org.isMonthlyPlan && balanceMinutes < 0;

  return (
    <div className="max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">
          {t("title", { name: org.name })}
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t("subtitle")}
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>{t("cardTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {canUpdate ? (
            <OrganizationForm
              mode="edit"
              initial={{
                id: org.id,
                name: org.name,
                abbreviation: org.abbreviation,
                isMonthlyPlan: org.isMonthlyPlan,
                monthlyHoursIncluded: minutesToHoursString(
                  org.monthlyMinutesIncluded,
                ),
                monthlyHoursBalance: minutesToHoursString(
                  org.monthlyMinutesBalance,
                ),
                contractNotes: org.contractNotes ?? "",
                emailDomains: org.emailDomains.join("\n"),
                isActive: org.isActive,
              }}
            />
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t("readOnly")}
            </p>
          )}
        </CardContent>
      </Card>

      {org.isMonthlyPlan ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("planCardTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {t("planIncluded")}
                </div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {hoursDisplay(org.monthlyMinutesIncluded)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {t("planRemaining")}
                </div>
                <div
                  className={`mt-1 text-2xl font-semibold tabular-nums ${
                    isNegative ? "text-red-600 dark:text-red-400" : ""
                  }`}
                >
                  {hoursDisplay(org.monthlyMinutesBalance)}
                </div>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {t("planUsed")}
                </div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {hoursDisplay(usedMinutes)}
                </div>
              </div>
            </div>

            <div
              className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
              role="progressbar"
              aria-valuenow={usedPct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={`h-full rounded-full ${
                  isNegative ? "bg-red-500" : "bg-blue-500"
                }`}
                style={{ width: `${isNegative ? 100 : usedPct}%` }}
              />
            </div>

            {isNegative ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
                {t("planNegative", {
                  hours: hoursDisplay(Math.abs(balanceMinutes)),
                })}
              </p>
            ) : null}

            {canUpdate ? <AddHoursControl organizationId={org.id} /> : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("usageCardTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <OrgUsageBreakdown usage={usage} />
        </CardContent>
      </Card>
    </div>
  );
}
