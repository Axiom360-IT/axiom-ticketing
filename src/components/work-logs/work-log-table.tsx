"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { DataTable } from "@/components/ui/data-table";
import type { FilterOption } from "@/components/ui/data-table-column-header";
import { BillingBadge } from "@/components/tickets/badges";
import { TimesheetRowActions } from "@/components/work-logs/timesheet-row-actions";

export type WorkLogTableRow = {
  id: string;
  ticketId: string;
  ticketNumber: string;
  organizationName: string | null;
  technicianName: string | null;
  description: string;
  minutes: number;
  serviceType: string;
  billable: string | null;
  invoiceNumber: string | null;
  createdLabel: string;
  canManage: boolean;
};

const BILLABLE_VALUES = ["yes", "no", "monthly_plan", "project", "rework"];

function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function WorkLogTable({
  data,
  totalItems,
  pageSize,
  emptyMessage,
  canViewAll,
  technicianOptions,
  organizationOptions,
}: {
  data: WorkLogTableRow[];
  totalItems: number;
  pageSize: number;
  emptyMessage: string;
  canViewAll: boolean;
  technicianOptions: FilterOption[];
  organizationOptions: FilterOption[];
}) {
  const t = useTranslations("timesheet");
  const tWorkLog = useTranslations("tickets.workLog");
  const tBillable = useTranslations("tickets.billable");
  const tCommon = useTranslations("common");

  const columns = useMemo<ColumnDef<WorkLogTableRow>[]>(
    () => {
      const billableLabel = (value: string | null): string => {
        if (!value) return "—";
        return BILLABLE_VALUES.includes(value)
          ? tBillable(value as (typeof BILLABLE_VALUES)[number])
          : value;
      };

      const cols: ColumnDef<WorkLogTableRow>[] = [
        {
          id: "ticket",
          meta: {
            title: t("columns.ticket"),
            sortKey: "ticket",
            filter: {
              kind: "enum",
              param: "organization",
              searchable: true,
              options: [
                ...organizationOptions,
              ],
            },
          },
          cell: ({ row }) => (
            <>
              <Link
                href={`/admin/tickets/${row.original.ticketId}`}
                className="font-mono text-blue-600 hover:underline dark:text-blue-400"
              >
                {row.original.ticketNumber}
              </Link>
              {row.original.organizationName ? (
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                  {row.original.organizationName}
                </span>
              ) : null}
            </>
          ),
        },
        {
          id: "description",
          meta: {
            title: t("columns.description"),
            sortKey: "description",
            cellClassName: "max-w-xs",
          },
          cell: ({ row }) => (
            <span className="block truncate" title={row.original.description}>
              {row.original.description}
            </span>
          ),
        },
        {
          id: "time",
          meta: {
            title: t("columns.time"),
            sortKey: "time",
            cellClassName: "tabular-nums",
          },
          cell: ({ row }) => formatMinutes(row.original.minutes),
        },
        {
          id: "service",
          meta: {
            title: t("columns.service"),
            sortKey: "service",
            filter: {
              kind: "enum",
              param: "service",
              options: [
                { value: "remote", label: tWorkLog("serviceRemote") },
                { value: "onsite", label: tWorkLog("serviceOnsite") },
              ],
            },
          },
          cell: ({ row }) =>
            row.original.serviceType === "onsite"
              ? tWorkLog("serviceOnsite")
              : tWorkLog("serviceRemote"),
        },
        {
          id: "billable",
          meta: {
            title: t("columns.billable"),
            sortKey: "billable",
            filter: {
              kind: "enum",
              param: "billable",
              options: [
                ...BILLABLE_VALUES.map((v) => ({
                  value: v,
                  label: tBillable(v as (typeof BILLABLE_VALUES)[number]),
                })),
              ],
            },
          },
          cell: ({ row }) => billableLabel(row.original.billable),
        },
        {
          id: "invoice",
          meta: { title: t("columns.invoice") },
          cell: ({ row }) => (
            <BillingBadge
              billable={row.original.billable}
              invoiceNumber={row.original.invoiceNumber}
            />
          ),
        },
        {
          id: "date",
          meta: {
            title: t("columns.date"),
            sortKey: "date",
            filter: { kind: "dateRange", fromParam: "from", toParam: "to" },
            cellClassName: "whitespace-nowrap text-zinc-500 dark:text-zinc-400",
          },
          cell: ({ row }) => row.original.createdLabel,
        },
        {
          id: "actions",
          meta: { title: tCommon("actions"), sticky: true },
          cell: ({ row }) => (
            <TimesheetRowActions
              canManage={row.original.canManage}
              entry={{
                id: row.original.id,
                description: row.original.description,
                minutes: row.original.minutes,
                serviceType: row.original.serviceType,
                ticketNumber: row.original.ticketNumber,
              }}
            />
          ),
        },
      ];

      // Technician column (with its filter) is oversight-only.
      if (canViewAll) {
        cols.splice(1, 0, {
          id: "technician",
          meta: {
            title: t("columns.technician"),
            sortKey: "technician",
            filter: {
              kind: "enum",
              param: "technician",
              searchable: true,
              options: [
                ...technicianOptions,
              ],
            },
          },
          cell: ({ row }) =>
            row.original.technicianName ?? tWorkLog("unknownTech"),
        });
      }

      return cols;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canViewAll, technicianOptions, organizationOptions],
  );

  return (
    <DataTable
      columns={columns}
      data={data}
      totalItems={totalItems}
      pageSize={pageSize}
      emptyMessage={emptyMessage}
    />
  );
}
