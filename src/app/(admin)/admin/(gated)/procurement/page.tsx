import Link from "next/link";
import { redirect } from "next/navigation";
import { inArray } from "drizzle-orm";
import { getFormatter, getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ProcurementStatusBadge } from "@/components/procurement/status-badge";
import { listProcurementForAdmin } from "@/app/actions/procurement";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema/tickets";

export const dynamic = "force-dynamic";

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
  const rows = await listProcurementForAdmin({
    status: sp.status,
    type: sp.type,
    urgency: sp.urgency,
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
  const formatter = await getFormatter();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t("subtitle")} · {t("count", { count: rows.length })}
        </p>
      </div>

      <form
        className="flex flex-wrap gap-3 items-end"
        action="/admin/procurement"
        method="get"
      >
        <FilterSelect
          name="status"
          label={t("filterStatus")}
          initial={sp.status}
          anyLabel={t("filterAny")}
          options={STATUSES.map((s) => ({ value: s, label: tStatus(s) }))}
        />
        <FilterSelect
          name="type"
          label={t("filterType")}
          initial={sp.type}
          anyLabel={t("filterAny")}
          options={TYPES.map((v) => ({
            value: v,
            label: tType(v),
          }))}
        />
        <FilterSelect
          name="urgency"
          label={t("filterUrgency")}
          initial={sp.urgency}
          anyLabel={t("filterAny")}
          options={URGENCIES.map((v) => ({
            value: v,
            label: tUrgency(v),
          }))}
        />
      </form>

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
                  <TableHead className="pr-4">
                    {t("columns.createdAt")}
                  </TableHead>
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
                    <TableCell className="pr-4 text-xs text-zinc-500 dark:text-zinc-400">
                      {formatter.dateTime(r.createdAt, {
                        dateStyle: "medium",
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FilterSelect({
  name,
  label,
  initial,
  options,
  anyLabel,
}: {
  name: string;
  label: string;
  initial?: string;
  options: { value: string; label: string }[];
  anyLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-zinc-500 dark:text-zinc-400">{label}</label>
      <Select name={name} defaultValue={initial ?? ""}>
        <SelectTrigger className="h-8 w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">{anyLabel}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
