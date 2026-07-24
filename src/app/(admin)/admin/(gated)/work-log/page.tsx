import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import {
  Pagination,
  pageWindow,
  parsePage,
  parsePageSize,
  takePage,
} from "@/components/ui/pagination";
import { AddTimeModal } from "@/components/work-logs/add-time-modal";
import { WorkLogTable } from "@/components/work-logs/work-log-table";
import { getSessionUser } from "@/lib/auth/session";
import { listAssignableTechnicians } from "@/lib/tickets/load";
import {
  listLoggableTickets,
  listOrganizationsForFilter,
  listUserCollaboratorTicketIds,
  listWorkLogs,
} from "@/lib/work-logs/queries";

// Filter query string contract (all now driven by the column headers):
//   ?technician=<uuid>  (view_all only)  &organization=<uuid>
//   &service=onsite|remote  &billable=yes|no|monthly_plan|project|rework
//   &from=YYYY-MM-DD  &to=YYYY-MM-DD  (inclusive, on entry date)
//   &sort=<column>:<asc|desc>
type SearchParams = Promise<{
  technician?: string;
  organization?: string;
  service?: string;
  billable?: string;
  from?: string;
  to?: string;
  sort?: string;
  page?: string;
  pageSize?: string;
}>;

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
  const formatter = await getFormatter();

  const sp = await searchParams;
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.pageSize);
  const { limit, offset } = pageWindow(page, pageSize);

  const [
    { rows: rawRows, totalMinutes, totalCount },
    technicians,
    organizations,
    loggable,
    collaboratorTicketIds,
  ] = await Promise.all([
    listWorkLogs(
      user,
      {
        technicianId: sp.technician?.trim() || undefined,
        organizationId: sp.organization?.trim() || undefined,
        serviceType: sp.service?.trim() || undefined,
        billable: sp.billable?.trim() || undefined,
        from: sp.from?.trim() || undefined,
        to: sp.to?.trim() || undefined,
        sort: sp.sort,
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

  const { items: rows } = takePage(rawRows, pageSize);

  // An entry is editable only by its ORIGINAL author, and only while that
  // author still owns the ticket (current assignee or merge co-assignee) —
  // frozen history, matching the server-side gate. Precomputed here.
  const collaboratorSet = new Set(collaboratorTicketIds);
  const viewerId = user.id;
  function canManageRow(
    assignedToId: string | null,
    ticketId: string,
    technicianId: string | null,
  ): boolean {
    if (technicianId !== viewerId) return false;
    return assignedToId === viewerId || collaboratorSet.has(ticketId);
  }

  const tableRows = rows.map((row) => ({
    id: row.id,
    ticketId: row.ticketId,
    ticketNumber: row.ticketNumber,
    organizationName: row.organizationName,
    technicianName: row.technicianName,
    description: row.description,
    minutes: row.minutes,
    serviceType: row.serviceType,
    billable: row.billable,
    invoiceNumber: row.invoiceNumber,
    createdLabel: formatter.dateTime(row.createdAt, { dateStyle: "medium" }),
    canManage: canManageRow(
      row.ticketAssignedToId,
      row.ticketId,
      row.technicianId,
    ),
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">{t("title")}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {canViewAll ? t("subtitleAll") : t("subtitleOwn")}
          </p>
        </div>
        <AddTimeModal tickets={loggable} />
      </div>

      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-zinc-500 dark:text-zinc-400">
          {t("totalLabel")}
        </span>
        <span className="text-base font-semibold tabular-nums">
          {formatMinutes(totalMinutes)}
        </span>
      </div>

      <WorkLogTable
        data={tableRows}
        totalItems={totalCount}
        pageSize={pageSize}
        emptyMessage={t("empty")}
        canViewAll={canViewAll}
        technicianOptions={technicians.map((tech) => ({
          value: tech.id,
          label: tech.name,
        }))}
        organizationOptions={organizations.map((o) => ({
          value: o.id,
          label: o.name,
        }))}
      />

      <Pagination
        pathname="/admin/work-log"
        page={page}
        pageSize={pageSize}
        totalItems={totalCount}
        searchParams={new URLSearchParams(
          Object.entries(sp).filter(
            ([, v]) => typeof v === "string" && v.length > 0,
          ) as [string, string][],
        )}
      />
    </div>
  );
}
