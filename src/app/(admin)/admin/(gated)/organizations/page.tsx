import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  StickyActionsCell,
  StickyActionsHead,
} from "@/components/ui/row-actions";
import { OrgRowActions } from "@/components/organizations/org-row-actions";
import { listOrganizationsForAdmin } from "@/app/actions/organizations";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";

function formatHours(minutes: number | null): string | null {
  if (minutes === null) return null;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2);
}

export default async function OrganizationsListPage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (
    !(await can(user, "organizations.view", { type: "global" }, productionContext))
  ) {
    redirect("/admin");
  }

  const [rows, canCreate, canEdit, canDelete] = await Promise.all([
    listOrganizationsForAdmin(),
    can(user, "organizations.create", { type: "global" }, productionContext),
    can(user, "organizations.update", { type: "global" }, productionContext),
    can(user, "organizations.delete", { type: "global" }, productionContext),
  ]);
  const t = await getTranslations("organizations.list");
  const tCommon = await getTranslations("common");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("subtitle")} · {t("count", { count: rows.length })}
          </p>
        </div>
        {canCreate ? (
          <Button
            nativeButton={false}
            render={<Link href="/admin/organizations/new" />}
          >
            {t("createButton")}
          </Button>
        ) : null}
      </div>

      <Card className="p-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">{t("columns.name")}</TableHead>
                <TableHead>{t("columns.abbreviation")}</TableHead>
                <TableHead>{t("columns.plan")}</TableHead>
                <TableHead>{t("columns.balance")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <StickyActionsHead>{tCommon("actions")}</StickyActionsHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((o) => {
                const balance = formatHours(o.monthlyMinutesBalance);
                const included = formatHours(o.monthlyMinutesIncluded);
                return (
                  <TableRow key={o.id}>
                    <TableCell className="px-4">
                      <Link
                        href={`/admin/organizations/${o.id}`}
                        className="text-blue-600 hover:underline dark:text-blue-400 font-medium"
                      >
                        {o.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {o.abbreviation}
                    </TableCell>
                    <TableCell className="text-xs">
                      {o.isMonthlyPlan ? t("monthlyPlan") : t("oneOff")}
                    </TableCell>
                    <TableCell className="text-xs text-zinc-500 dark:text-zinc-400">
                      {o.isMonthlyPlan && balance !== null
                        ? t("balanceHours", {
                            balance,
                            included: included ?? "—",
                          })
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {o.isActive ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900">
                          {t("active")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border bg-zinc-100 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                          {t("inactive")}
                        </span>
                      )}
                    </TableCell>
                    <StickyActionsCell>
                      <OrgRowActions
                        organization={{ id: o.id, name: o.name }}
                        canEdit={canEdit}
                        canDelete={canDelete}
                      />
                    </StickyActionsCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
