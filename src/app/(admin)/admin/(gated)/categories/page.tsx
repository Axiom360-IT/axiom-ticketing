import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AddTaxonomyButton } from "@/components/settings/add-taxonomy-button";
import {
  TaxonomyTable,
  type TaxonomyRow,
} from "@/components/settings/taxonomy-table";
import {
  Pagination,
  parsePage,
  parsePageSize,
} from "@/components/ui/pagination";
import { UrlSearchInput } from "@/components/ui/url-search-input";
import { listCategoriesForAdmin } from "@/app/actions/categories";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";
import { parseCsv } from "@/lib/data-table";

type SearchParams = Promise<{
  q?: string;
  status?: string;
  page?: string;
  pageSize?: string;
}>;

export async function generateMetadata() {
  const t = await getTranslations("categories");
  return { title: t("title") };
}

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (
    !(await can(user, "settings.update", { type: "global" }, productionContext))
  ) {
    redirect("/admin");
  }

  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const statusList = parseCsv(sp.status);
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.pageSize);

  const items = await listCategoriesForAdmin();
  // Reorder is global, so stamp first/last on the FULL ordered list before
  // any search/filter/paging narrows the view.
  const all: TaxonomyRow[] = items.map((c, i) => ({
    ...c,
    isFirst: i === 0,
    isLast: i === items.length - 1,
  }));

  const filtered = all.filter((r) => {
    if (q && !`${r.label} ${r.value}`.toLowerCase().includes(q)) return false;
    if (
      statusList.length &&
      !statusList.includes(r.isActive ? "active" : "inactive")
    ) {
      return false;
    }
    return true;
  });

  const totalItems = filtered.length;
  const offset = (page - 1) * pageSize;
  const rows = filtered.slice(offset, offset + pageSize);
  const hasFilters = q !== "" || statusList.length > 0;

  const t = await getTranslations("categories");

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">{t("title")}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("subtitle")} · {t("count", { count: totalItems })}
          </p>
        </div>
        <AddTaxonomyButton kind="category" namespace="categories" />
      </div>

      <UrlSearchInput
        initialValue={sp.q ?? ""}
        placeholder={t("search")}
        className="max-w-md"
      />

      <TaxonomyTable
        kind="category"
        namespace="categories"
        data={rows}
        totalItems={totalItems}
        pageSize={pageSize}
        emptyMessage={hasFilters ? t("emptyFiltered") : t("empty")}
        canManage
      />

      <Pagination
        pathname="/admin/categories"
        page={page}
        pageSize={pageSize}
        totalItems={totalItems}
        searchParams={
          new URLSearchParams(
            Object.entries(sp).filter(
              ([, v]) => typeof v === "string" && v.length > 0,
            ) as [string, string][],
          )
        }
      />

      <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("hint")}</p>
    </div>
  );
}
