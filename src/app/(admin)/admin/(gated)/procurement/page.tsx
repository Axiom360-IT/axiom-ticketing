import { redirect } from "next/navigation";
import { inArray } from "drizzle-orm";
import { getFormatter, getTranslations } from "next-intl/server";
import { ExportMenu } from "@/components/shared/export-menu";
import {
  Pagination,
  parsePage,
  parsePageSize,
} from "@/components/ui/pagination";
import { UrlSearchInput } from "@/components/ui/url-search-input";
import { ProcurementTable } from "@/components/procurement/procurement-table";
import { listProcurementForAdmin } from "@/app/actions/procurement";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema/tickets";

type SearchParams = Promise<{
  q?: string;
  status?: string;
  type?: string;
  from?: string;
  to?: string;
  sort?: string;
  page?: string;
  pageSize?: string;
}>;

export default async function ProcurementListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (
    !(await can(user, "procurement.view", { type: "global" }, productionContext))
  ) {
    redirect("/admin");
  }

  const canExport = await can(
    user,
    "procurement.export",
    { type: "global" },
    productionContext,
  );

  const sp = await searchParams;
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.pageSize);
  const { items: rows, total: totalItems } = await listProcurementForAdmin({
    q: sp.q,
    status: sp.status,
    type: sp.type,
    from: sp.from,
    to: sp.to,
    sort: sp.sort,
    page,
    pageSize,
  });

  // Resolve ticket numbers in one round-trip.
  const ticketIds = Array.from(new Set(rows.map((r) => r.ticketId)));
  const ticketRows =
    ticketIds.length > 0
      ? await db
          .select({ id: tickets.id, ticketNumber: tickets.ticketNumber })
          .from(tickets)
          .where(inArray(tickets.id, ticketIds))
      : [];
  const numberByTicket = new Map(
    ticketRows.map((tk) => [tk.id, tk.ticketNumber]),
  );

  const t = await getTranslations("procurement.list");
  const formatter = await getFormatter();

  const tableRows = rows.map((r) => ({
    ...r,
    ticketNumber: numberByTicket.get(r.ticketId) ?? null,
    createdLabel: formatter.dateTime(r.createdAt, { dateStyle: "medium" }),
  }));

  const exportParams: Record<string, string> = {};
  for (const k of ["q", "status", "type", "from", "to"] as const) {
    const v = sp[k];
    if (typeof v === "string" && v.length > 0) exportParams[k] = v;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">{t("title")}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("subtitle")} · {t("count", { count: totalItems })}
          </p>
        </div>
        {canExport ? (
          <ExportMenu baseHref="/api/procurement/export" params={exportParams} />
        ) : null}
      </div>

      {/* Type, status and date filters now live in the column headers. */}
      <UrlSearchInput
        initialValue={sp.q ?? ""}
        placeholder={t("search")}
        className="max-w-md"
      />

      <ProcurementTable
        data={tableRows}
        totalItems={totalItems}
        pageSize={pageSize}
        emptyMessage={t("empty")}
      />

      <Pagination
        pathname="/admin/procurement"
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
