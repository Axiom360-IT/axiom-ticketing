import Link from "next/link";
import { redirect } from "next/navigation";
import { inArray } from "drizzle-orm";
import { getFormatter, getTranslations } from "next-intl/server";
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
} from "@/components/ui/pagination";
import { UrlFilterSelect } from "@/components/ui/url-filter-select";
import { ProcurementRowActions } from "@/components/procurement/procurement-row-actions";
import { ProcurementStatusBadge } from "@/components/procurement/status-badge";
import { listProcurementForAdmin } from "@/app/actions/procurement";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema/tickets";

const STATUSES = [
  "pending_coordinator_approval",
  "pending_admin_approval",
  "approved",
  "purchased",
  "delivered",
  "rejected",
] as const;
const TYPES = ["hardware", "software"] as const;
const URGENCIES = ["low", "medium", "high"] as const;

type SearchParams = Promise<{
  status?: string;
  type?: string;
  urgency?: string;
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

  const sp = await searchParams;
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.pageSize);
  const { items: rows, hasMore } = await listProcurementForAdmin({
    status: sp.status,
    type: sp.type,
    urgency: sp.urgency,
    page,
    pageSize,
  });

  // Resolve ticket numbers in one round-trip
  const ticketIds = Array.from(new Set(rows.map((r) => r.ticketId)));
  const ticketRows =
    ticketIds.length > 0
      ? await db
          .select({
            id: tickets.id,
            ticketNumber: tickets.ticketNumber,
          })
          .from(tickets)
          .where(inArray(tickets.id, ticketIds))
      : [];
  const numberByTicket = new Map(
    ticketRows.map((t) => [t.id, t.ticketNumber]),
  );

  const t = await getTranslations("procurement.list");
  const tType = await getTranslations("procurement.type");
  const tUrgency = await getTranslations("procurement.urgency");
  const tStatus = await getTranslations("procurement.status");
  const tCommon = await getTranslations("common");
  const formatter = await getFormatter();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t("subtitle")} · {t("count", { count: rows.length })}
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <UrlFilterSelect
          name="status"
          label={t("filterStatus")}
          value={sp.status ?? ""}
          anyLabel={t("filterAny")}
          options={STATUSES.map((s) => ({ value: s, label: tStatus(s) }))}
          triggerClassName="w-44"
        />
        <UrlFilterSelect
          name="type"
          label={t("filterType")}
          value={sp.type ?? ""}
          anyLabel={t("filterAny")}
          options={TYPES.map((v) => ({ value: v, label: tType(v) }))}
          triggerClassName="w-40"
        />
        <UrlFilterSelect
          name="urgency"
          label={t("filterUrgency")}
          value={sp.urgency ?? ""}
          anyLabel={t("filterAny")}
          options={URGENCIES.map((v) => ({ value: v, label: tUrgency(v) }))}
          triggerClassName="w-40"
        />
      </div>

      <Card className="p-0">
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {t("empty")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">{t("columns.item")}</TableHead>
                  <TableHead>{t("columns.type")}</TableHead>
                  <TableHead>{t("columns.urgency")}</TableHead>
                  <TableHead>{t("columns.cost")}</TableHead>
                  <TableHead>{t("columns.status")}</TableHead>
                  <TableHead>{t("columns.requester")}</TableHead>
                  <TableHead>{t("columns.ticket")}</TableHead>
                  <TableHead>{t("columns.createdAt")}</TableHead>
                  <StickyActionsHead>{tCommon("actions")}</StickyActionsHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="px-4">
                      <Link
                        href={`/admin/procurement/${r.id}`}
                        className="text-blue-600 hover:underline dark:text-blue-400 font-medium"
                      >
                        {r.itemName}
                      </Link>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {t("qty", { count: r.quantity })}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {tType(r.type as "hardware" | "software")}
                    </TableCell>
                    <TableCell className="text-sm">
                      {tUrgency(r.urgency as "low" | "medium" | "high")}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.estimatedCost ?? ""}
                    </TableCell>
                    <TableCell>
                      <ProcurementStatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-xs text-zinc-500 dark:text-zinc-400">
                      {r.requestedByEmail}
                    </TableCell>
                    <TableCell className="text-xs">
                      <Link
                        href={`/admin/tickets/${r.ticketId}`}
                        className="font-mono text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {numberByTicket.get(r.ticketId) ?? ""}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-zinc-500 dark:text-zinc-400">
                      {formatter.dateTime(r.createdAt, {
                        dateStyle: "medium",
                      })}
                    </TableCell>
                    <StickyActionsCell>
                      <ProcurementRowActions
                        request={{
                          id: r.id,
                          itemName: r.itemName,
                          quantity: r.quantity,
                          type: r.type,
                          urgency: r.urgency,
                          status: r.status,
                          estimatedCost: r.estimatedCost,
                          requestedByEmail: r.requestedByEmail,
                          ticketId: r.ticketId,
                          ticketNumber: numberByTicket.get(r.ticketId) ?? null,
                          createdAt: r.createdAt,
                        }}
                      />
                    </StickyActionsCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Pagination
        pathname="/admin/procurement"
        page={page}
        pageSize={pageSize}
        hasMore={hasMore}
        searchParams={new URLSearchParams(
          Object.entries(sp).filter(
            ([, v]) => typeof v === "string" && v.length > 0,
          ) as [string, string][],
        )}
        labels={{
          previous: tCommon("pagination.previous"),
          next: tCommon("pagination.next"),
          page: tCommon("pagination.page", { page }),
          rowsPerPage: tCommon("pagination.rowsPerPage"),
        }}
      />
    </div>
  );
}
