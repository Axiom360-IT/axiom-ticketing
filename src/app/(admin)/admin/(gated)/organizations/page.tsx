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
import {
  Pagination,
  parsePage,
  parsePageSize,
  reservedTableHeight,
} from "@/components/ui/pagination";
import { UrlFilterSelect } from "@/components/ui/url-filter-select";
import { UrlSearchInput } from "@/components/ui/url-search-input";
import { OrgRowActions } from "@/components/organizations/org-row-actions";
import {
  countUnverifiedOrgTickets,
  listOrganizationsForAdmin,
} from "@/app/actions/organizations";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";

function formatHours(minutes: number | null): string | null {
  if (minutes === null) return null;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2);
}

type SearchParams = Promise<{
  q?: string;
  plan?: string;
  status?: string;
  page?: string;
  pageSize?: string;
}>;

export default async function OrganizationsListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (
    !(await can(user, "organizations.view", { type: "global" }, productionContext))
  ) {
    redirect("/admin");
  }

  const [allRows, canCreate, canEdit, canDelete, unverifiedCount] =
    await Promise.all([
      listOrganizationsForAdmin(),
      can(user, "organizations.create", { type: "global" }, productionContext),
      can(user, "organizations.update", { type: "global" }, productionContext),
      can(user, "organizations.delete", { type: "global" }, productionContext),
      countUnverifiedOrgTickets(),
    ]);
  const t = await getTranslations("organizations.list");
  const tTriage = await getTranslations("orgTriage");
  const tCommon = await getTranslations("common");

  // listOrganizationsForAdmin returns the full set (client roster — bounded).
  // Filter + paginate in memory, mirroring the users/roles pages.
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const plan = sp.plan === "monthly" || sp.plan === "one_off" ? sp.plan : "";
  const status =
    sp.status === "active" || sp.status === "inactive" ? sp.status : "";
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.pageSize);

  const filtered = allRows.filter((o) => {
    if (q && !`${o.name} ${o.abbreviation}`.toLowerCase().includes(q)) {
      return false;
    }
    if (plan === "monthly" && !o.isMonthlyPlan) return false;
    if (plan === "one_off" && o.isMonthlyPlan) return false;
    if (status === "active" && !o.isActive) return false;
    if (status === "inactive" && o.isActive) return false;
    return true;
  });

  const totalItems = filtered.length;
  const offset = (page - 1) * pageSize;
  const rows = filtered.slice(offset, offset + pageSize);
  const hasFilters = q !== "" || plan !== "" || status !== "";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">{t("title")}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("subtitle")} · {t("count", { count: totalItems })}
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

      {canEdit && unverifiedCount > 0 ? (
        <Link
          href="/admin/org-triage"
          className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60"
        >
          <span>{tTriage("banner", { count: unverifiedCount })}</span>
          <span className="font-medium underline">{tTriage("bannerCta")}</span>
        </Link>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[14rem]">
          <UrlSearchInput
            initialValue={sp.q ?? ""}
            placeholder={t("search")}
            className="max-w-md"
          />
        </div>
        <UrlFilterSelect
          name="plan"
          label={t("filterPlan")}
          value={plan}
          anyLabel={t("filterAny")}
          options={[
            { value: "monthly", label: t("monthlyPlan") },
            { value: "one_off", label: t("oneOff") },
          ]}
          triggerClassName="w-40"
        />
        <UrlFilterSelect
          name="status"
          label={t("filterStatus")}
          value={status}
          anyLabel={t("filterAny")}
          options={[
            { value: "active", label: t("active") },
            { value: "inactive", label: t("inactive") },
          ]}
          triggerClassName="w-36"
        />
      </div>

      <Card className="p-0">
        <CardContent
          className="p-0"
          style={{ minHeight: reservedTableHeight(pageSize, totalItems) }}
        >
          {rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {hasFilters ? t("emptyFiltered") : t("empty")}
            </div>
          ) : (
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
          )}
        </CardContent>
      </Card>

      <Pagination
        pathname="/admin/organizations"
        page={page}
        pageSize={pageSize}
        totalItems={totalItems}
        searchParams={new URLSearchParams(
          Object.entries(sp).filter(
            ([, v]) => typeof v === "string" && v.length > 0,
          ) as [string, string][],
        )}
      />
    </div>
  );
}
