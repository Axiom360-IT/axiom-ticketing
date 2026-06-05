import Link from "next/link";
import { redirect } from "next/navigation";
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
  pageWindow,
  parsePage,
  parsePageSize,
  takePage,
} from "@/components/ui/pagination";
import { AddTimeModal } from "@/components/work-logs/add-time-modal";
import { TimesheetFilters } from "@/components/work-logs/timesheet-filters";
import { TimesheetRowActions } from "@/components/work-logs/timesheet-row-actions";
import { getSessionUser } from "@/lib/auth/session";
import { listAssignableTechnicians } from "@/lib/tickets/load";
import {
  listLoggableTickets,
  listOrganizationsForFilter,
  listUserCollaboratorTicketIds,
  listWorkLogs,
} from "@/lib/work-logs/queries";

// Filter query string contract:
//   ?technician=<uuid>     (view_all only; ignored otherwise)
//   &organization=<uuid>
//   &service=onsite|remote
//   &billable=yes|no|monthly_plan|project|rework
//   &from=YYYY-MM-DD  &to=YYYY-MM-DD   (inclusive, on entry date)
type SearchParams = Promise<{
  technician?: string;
  organization?: string;
  service?: string;
  billable?: string;
  from?: string;
  to?: string;
  page?: string;
  pageSize?: string;
}>;

const BILLABLE_VALUES = [
  "yes",
  "no",
  "monthly_plan",
  "project",
  "rework",
] as const;

function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export default async function WorkLogPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  // Anyone who can log work gets a timesheet (their own). worklog.view_all
  // additionally unlocks seeing everyone's — enforced in the query.
  if (!user.permissions.has("tickets.update")) redirect("/admin");
  const canViewAll = user.permissions.has("worklog.view_all");

  const t = await getTranslations("timesheet");
  const tWorkLog = await getTranslations("tickets.workLog");
  const tBillable = await getTranslations("tickets.billable");
  const tCommon = await getTranslations("common");
  const formatter = await getFormatter();

  const sp = await searchParams;
  const filters = {
    technician: sp.technician?.trim() || "",
    organization: sp.organization?.trim() || "",
    service: sp.service?.trim() || "",
    billable: sp.billable?.trim() || "",
    from: sp.from?.trim() || "",
    to: sp.to?.trim() || "",
  };
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.pageSize);
  const { limit, offset } = pageWindow(page, pageSize);

  const [
    { rows: rawRows, totalMinutes },
    technicians,
    organizations,
    loggable,
    collaboratorTicketIds,
  ] = await Promise.all([
    listWorkLogs(
      user,
      {
        technicianId: filters.technician || undefined,
        organizationId: filters.organization || undefined,
        serviceType: filters.service || undefined,
        billable: filters.billable || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
      },
      { limit, offset },
    ),
    canViewAll ? listAssignableTechnicians() : Promise.resolve([]),
    listOrganizationsForFilter(),
    listLoggableTickets(user.id),
    // Needed for ALL viewers (incl. Super Admin) — even a view_all user may
    // only manage their OWN entries on tickets they currently own/co-own.
    listUserCollaboratorTicketIds(user.id),
  ]);

  const { items: rows, hasMore } = takePage(rawRows, pageSize);

  // An entry is editable only by its ORIGINAL author (req 3.5 / 4.6 — frozen
  // history: not even an admin or the new owner may edit someone else's entry),
  // and only while that author still owns the ticket (current assignee or merge
  // co-assignee). Once reassigned away, the author's own entry becomes
  // read-only here too — matching the server-side gate.
  const collaboratorSet = new Set(collaboratorTicketIds);
  const viewerId = user.id;
  function canManageRow(
    assignedToId: string | null,
    ticketId: string,
    technicianId: string | null,
  ): boolean {
    if (technicianId !== viewerId) return false;
    // Author-only is not enough — the author must still be on the ticket. This
    // applies to EVERY role (a Super Admin can't edit their own entry once
    // they've been reassigned away), matching the server-side guard.
    return assignedToId === viewerId || collaboratorSet.has(ticketId);
  }

  function billableLabel(value: string | null): string {
    if (!value) return "—";
    return (BILLABLE_VALUES as readonly string[]).includes(value)
      ? tBillable(value as (typeof BILLABLE_VALUES)[number])
      : value;
  }

  const colSpan = canViewAll ? 7 : 6;

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {canViewAll ? t("subtitleAll") : t("subtitleOwn")}
          </p>
        </div>
        <AddTimeModal tickets={loggable} />
      </div>

      <TimesheetFilters
        canViewAll={canViewAll}
        technicianOptions={technicians.map((tech) => ({
          value: tech.id,
          label: tech.name,
        }))}
        organizationOptions={organizations.map((o) => ({
          value: o.id,
          label: o.name,
        }))}
        serviceOptions={[
          { value: "remote", label: tWorkLog("serviceRemote") },
          { value: "onsite", label: tWorkLog("serviceOnsite") },
        ]}
        billableOptions={BILLABLE_VALUES.map((v) => ({
          value: v,
          label: tBillable(v),
        }))}
        initial={filters}
        labels={{
          technician: t("filters.technician"),
          organization: t("filters.organization"),
          service: t("filters.service"),
          billable: t("filters.billable"),
          from: t("filters.from"),
          to: t("filters.to"),
          clear: t("filters.clear"),
          any: t("filters.any"),
        }}
      />

      <div className="flex items-center justify-between text-sm">
        <span className="text-zinc-500 dark:text-zinc-400">
          {t("totalLabel")}
        </span>
        <span className="text-base font-semibold tabular-nums">
          {formatMinutes(totalMinutes)}
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("columns.ticket")}</TableHead>
                  {canViewAll ? (
                    <TableHead scope="col">
                      {t("columns.technician")}
                    </TableHead>
                  ) : null}
                  <TableHead scope="col">{t("columns.description")}</TableHead>
                  <TableHead scope="col">{t("columns.time")}</TableHead>
                  <TableHead scope="col">{t("columns.service")}</TableHead>
                  <TableHead scope="col">{t("columns.billable")}</TableHead>
                  <TableHead scope="col">{t("columns.date")}</TableHead>
                  <StickyActionsHead>
                    <span className="sr-only">{tCommon("actions")}</span>
                  </StickyActionsHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={colSpan + 1}
                      className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400"
                    >
                      {t("empty")}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Link
                          href={`/admin/tickets/${row.ticketId}`}
                          className="font-mono text-blue-600 hover:underline dark:text-blue-400"
                        >
                          {row.ticketNumber}
                        </Link>
                        {row.organizationName ? (
                          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                            {row.organizationName}
                          </span>
                        ) : null}
                      </TableCell>
                      {canViewAll ? (
                        <TableCell>
                          {row.technicianName ?? tWorkLog("unknownTech")}
                        </TableCell>
                      ) : null}
                      <TableCell className="max-w-xs">
                        <span className="block truncate" title={row.description}>
                          {row.description}
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatMinutes(row.minutes)}
                      </TableCell>
                      <TableCell>
                        {row.serviceType === "onsite"
                          ? tWorkLog("serviceOnsite")
                          : tWorkLog("serviceRemote")}
                      </TableCell>
                      <TableCell>{billableLabel(row.billable)}</TableCell>
                      <TableCell className="whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                        {formatter.dateTime(row.createdAt, {
                          dateStyle: "medium",
                        })}
                      </TableCell>
                      <StickyActionsCell>
                        <TimesheetRowActions
                          canManage={canManageRow(
                            row.ticketAssignedToId,
                            row.ticketId,
                            row.technicianId,
                          )}
                          entry={{
                            id: row.id,
                            description: row.description,
                            minutes: row.minutes,
                            serviceType: row.serviceType,
                            ticketNumber: row.ticketNumber,
                          }}
                        />
                      </StickyActionsCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Pagination
        pathname="/admin/work-log"
        page={page}
        pageSize={pageSize}
        hasMore={hasMore}
        searchParams={
          new URLSearchParams(
            Object.entries(sp).filter(
              ([, v]) => typeof v === "string" && v.length > 0,
            ) as [string, string][],
          )
        }
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
