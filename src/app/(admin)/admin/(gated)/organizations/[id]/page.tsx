import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OrganizationForm } from "@/components/organizations/organization-form";
import { getOrganizationDetail } from "@/app/actions/organizations";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";

function minutesToHoursString(minutes: number | null): string {
  if (minutes === null) return "";
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2);
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

  const t = await getTranslations("organizations.edit");

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
    </div>
  );
}
