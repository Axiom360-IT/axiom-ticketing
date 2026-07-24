import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import {
  Pagination,
  parsePage,
  parsePageSize,
} from "@/components/ui/pagination";
import { UrlSearchInput } from "@/components/ui/url-search-input";
import { ExportMenu } from "@/components/shared/export-menu";
import { OrganizationsTable } from "@/components/organizations/organizations-table";
import {
  countUnverifiedOrgTickets,
  listOrganizationsForAdmin,
} from "@/app/actions/organizations";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";
import { parseCsv, parseSort, sortRows } from "@/lib/data-table";

type SearchParams = Promise<{
  q?: string;
  plan?: string;
  status?: string;
  sort?: string;
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

  // listOrganizationsForAdmin returns the full set (client roster — bounded).
  // Filter + sort + paginate in memory. Plan/status filters + column sort come
  // from the column headers; the search box drives `q`.
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const planList = parseCsv(sp.plan);
  const statusList = parseCsv(sp.status);
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.pageSize);
  const sort = parseSort(sp.sort, [
    "name",
    "abbreviation",
    "plan",
    "balance",
    "status",
  ]);

  const filtered = allRows.filter((o) => {
    if (q && !`${o.name} ${o.abbreviation}`.toLowerCase().includes(q)) {
      return false;
    }
    if (
      planList.length &&
      !planList.includes(o.isMonthlyPlan ? "monthly" : "one_off")
    ) {
      return false;
    }
    if (
      statusList.length &&
      !statusList.includes(o.isActive ? "active" : "inactive")
    ) {
      return false;
    }
    return true;
  });
  const sorted = sortRows(filtered, sort, {
    name: (o) => o.name.toLowerCase(),
    abbreviation: (o) => o.abbreviation.toLowerCase(),
    plan: (o) => (o.isMonthlyPlan ? 1 : 0),
    balance: (o) => o.monthlyMinutesBalance,
    status: (o) => (o.isActive ? 1 : 0),
  });

  const totalItems = sorted.length;
  const offset = (page - 1) * pageSize;
  const rows = sorted.slice(offset, offset + pageSize);
  const hasFilters =
    q !== "" || planList.length > 0 || statusList.length > 0;

  // Carry the active filters so the export matches what's on screen.
  const exportParams: Record<string, string> = {};
  if (sp.q?.trim()) exportParams.q = sp.q.trim();
  if (sp.plan?.trim()) exportParams.plan = sp.plan.trim();
  if (sp.status?.trim()) exportParams.status = sp.status.trim();

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">{t("title")}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("subtitle")} · {t("count", { count: totalItems })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu
            baseHref="/api/organizations/export"
            params={exportParams}
          />
          {canCreate ? (
            <Button
              nativeButton={false}
              render={<Link href="/admin/organizations/new" />}
            >
              {t("createButton")}
            </Button>
          ) : null}
        </div>
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

      <UrlSearchInput
        initialValue={sp.q ?? ""}
        placeholder={t("search")}
        className="max-w-md"
      />

      <OrganizationsTable
        data={rows}
        totalItems={totalItems}
        pageSize={pageSize}
        emptyMessage={hasFilters ? t("emptyFiltered") : t("empty")}
        canEdit={canEdit}
        canDelete={canDelete}
      />

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
