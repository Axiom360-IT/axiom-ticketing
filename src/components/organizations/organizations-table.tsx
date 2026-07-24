"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { DataTable } from "@/components/ui/data-table";
import { OrgRowActions } from "@/components/organizations/org-row-actions";

export type OrgRow = {
  id: string;
  name: string;
  abbreviation: string;
  isMonthlyPlan: boolean;
  monthlyMinutesIncluded: number | null;
  monthlyMinutesBalance: number | null;
  isActive: boolean;
};

function formatHours(minutes: number | null): string | null {
  if (minutes === null) return null;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2);
}

export function OrganizationsTable({
  data,
  totalItems,
  pageSize,
  emptyMessage,
  canEdit,
  canDelete,
}: {
  data: OrgRow[];
  totalItems: number;
  pageSize: number;
  emptyMessage: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations("organizations.list");
  const tCommon = useTranslations("common");

  const columns = useMemo<ColumnDef<OrgRow>[]>(
    () => [
      {
        id: "name",
        meta: {
          title: t("columns.name"),
          sortKey: "name",
          headClassName: "px-4",
          cellClassName: "px-4",
        },
        cell: ({ row }) => (
          <Link
            href={`/admin/organizations/${row.original.id}`}
            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: "abbreviation",
        meta: {
          title: t("columns.abbreviation"),
          sortKey: "abbreviation",
          cellClassName: "font-mono text-xs",
        },
        cell: ({ row }) => row.original.abbreviation,
      },
      {
        id: "plan",
        meta: {
          title: t("columns.plan"),
          sortKey: "plan",
          filter: {
            kind: "enum",
            param: "plan",
            options: [
              { value: "monthly", label: t("monthlyPlan") },
              { value: "one_off", label: t("oneOff") },
            ],
          },
          cellClassName: "text-xs",
        },
        cell: ({ row }) =>
          row.original.isMonthlyPlan ? t("monthlyPlan") : t("oneOff"),
      },
      {
        id: "balance",
        meta: {
          title: t("columns.balance"),
          sortKey: "balance",
          cellClassName: "text-xs text-zinc-500 dark:text-zinc-400",
        },
        cell: ({ row }) => {
          const balance = formatHours(row.original.monthlyMinutesBalance);
          const included = formatHours(row.original.monthlyMinutesIncluded);
          return row.original.isMonthlyPlan && balance !== null
            ? t("balanceHours", { balance, included: included ?? "—" })
            : "—";
        },
      },
      {
        id: "status",
        meta: {
          title: t("columns.status"),
          sortKey: "status",
          filter: {
            kind: "enum",
            param: "status",
            options: [
              { value: "active", label: t("active") },
              { value: "inactive", label: t("inactive") },
            ],
          },
          cellClassName: "text-xs",
        },
        cell: ({ row }) =>
          row.original.isActive ? (
            <span className="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
              {t("active")}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[10px] font-medium dark:border-zinc-800 dark:bg-zinc-900">
              {t("inactive")}
            </span>
          ),
      },
      {
        id: "actions",
        meta: { title: tCommon("actions"), sticky: true },
        cell: ({ row }) => (
          <OrgRowActions
            organization={{ id: row.original.id, name: row.original.name }}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        ),
      },
    ],
    // Translators are stable at runtime (locale doesn't change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit, canDelete],
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
