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
import { RolesTable } from "@/components/roles/roles-table";
import { listRolesForAdmin } from "@/app/actions/roles";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";
import { parseCsv, parseSort, sortRows } from "@/lib/data-table";

type SearchParams = Promise<{
  q?: string;
  type?: string;
  sort?: string;
  page?: string;
  pageSize?: string;
}>;

export default async function RolesListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (!(await can(user, "roles.view", { type: "global" }, productionContext))) {
    redirect("/admin");
  }

  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const typeList = parseCsv(sp.type);
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.pageSize);
  const sort = parseSort(sp.sort, ["name", "type", "users", "description"]);

  const [allRows, canCreate, canEdit, canDelete] = await Promise.all([
    listRolesForAdmin(),
    can(user, "roles.create", { type: "global" }, productionContext),
    can(user, "roles.update", { type: "global" }, productionContext),
    can(user, "roles.delete", { type: "global" }, productionContext),
  ]);
  const t = await getTranslations("roles.list");

  // listRolesForAdmin returns the full set (small list — typically <20).
  // Filter + sort + paginate in memory. Type filter + column sort live in the
  // column headers; the search box drives `q`.
  const filtered = allRows.filter((r) => {
    if (q && !`${r.name} ${r.description ?? ""}`.toLowerCase().includes(q)) {
      return false;
    }
    if (
      typeList.length &&
      !typeList.includes(r.isSystem ? "system" : "custom")
    ) {
      return false;
    }
    return true;
  });
  const sorted = sortRows(filtered, sort, {
    name: (r) => r.name.toLowerCase(),
    type: (r) => (r.isSystem ? 1 : 0),
    users: (r) => r.userCount,
    description: (r) => (r.description ?? "").toLowerCase(),
  });

  const totalItems = sorted.length;
  const offset = (page - 1) * pageSize;
  const rows = sorted.slice(offset, offset + pageSize);
  const hasFilters = q !== "" || typeList.length > 0;

  // Carry the active filters so the export matches what's on screen.
  const exportParams: Record<string, string> = {};
  if (sp.q?.trim()) exportParams.q = sp.q.trim();
  if (sp.type?.trim()) exportParams.type = sp.type.trim();

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
          <ExportMenu baseHref="/api/roles/export" params={exportParams} />
          {canCreate ? (
            <Button
              nativeButton={false}
              render={<Link href="/admin/roles/new" />}
            >
              {t("createButton")}
            </Button>
          ) : null}
        </div>
      </div>

      <UrlSearchInput
        initialValue={sp.q ?? ""}
        placeholder={t("search")}
        className="max-w-md"
      />

      <RolesTable
        data={rows}
        totalItems={totalItems}
        pageSize={pageSize}
        emptyMessage={hasFilters ? t("emptyFiltered") : t("empty")}
        canEdit={canEdit}
        canDelete={canDelete}
      />

      <Pagination
        pathname="/admin/roles"
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
