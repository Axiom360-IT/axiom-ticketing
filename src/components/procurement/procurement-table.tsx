"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { DataTable } from "@/components/ui/data-table";
import { ProcurementRowActions } from "@/components/procurement/procurement-row-actions";
import { ProcurementStatusBadge } from "@/components/procurement/status-badge";

export type ProcurementRow = {
  id: string;
  itemName: string;
  quantity: number;
  type: string;
  status: string;
  estimatedCost: string | null;
  requestedByEmail: string | null;
  ticketId: string;
  ticketNumber: string | null;
  createdAt: Date;
  createdLabel: string;
};

const STATUSES = [
  "awaiting_customer_payment",
  "order_pending",
  "order_placed",
  "order_completed",
];
const TYPES = ["hardware", "software", "other"];

export function ProcurementTable({
  data,
  totalItems,
  pageSize,
  emptyMessage,
}: {
  data: ProcurementRow[];
  totalItems: number;
  pageSize: number;
  emptyMessage: string;
}) {
  const t = useTranslations("procurement.list");
  const tType = useTranslations("procurement.type");
  const tStatus = useTranslations("procurement.status");
  const tCommon = useTranslations("common");

  const columns = useMemo<ColumnDef<ProcurementRow>[]>(
    () => [
      {
        id: "item",
        meta: {
          title: t("columns.item"),
          sortKey: "item",
          headClassName: "px-4",
          cellClassName: "px-4",
        },
        cell: ({ row }) => (
          <>
            <Link
              href={`/admin/procurement/${row.original.id}`}
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              {row.original.itemName}
            </Link>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("qty", { count: row.original.quantity })}
            </div>
          </>
        ),
      },
      {
        id: "type",
        meta: {
          title: t("columns.type"),
          sortKey: "type",
          filter: {
            kind: "enum",
            param: "type",
            options: TYPES.map((v) => ({ value: v, label: tType(v) })),
          },
          cellClassName: "text-sm",
        },
        cell: ({ row }) =>
          tType(row.original.type as "hardware" | "software" | "other"),
      },
      {
        id: "cost",
        meta: {
          title: t("columns.cost"),
          sortKey: "cost",
          cellClassName: "text-sm",
        },
        cell: ({ row }) => row.original.estimatedCost ?? "",
      },
      {
        id: "status",
        meta: {
          title: t("columns.status"),
          sortKey: "status",
          filter: {
            kind: "enum",
            param: "status",
            options: STATUSES.map((v) => ({ value: v, label: tStatus(v) })),
          },
        },
        cell: ({ row }) => <ProcurementStatusBadge status={row.original.status} />,
      },
      {
        id: "requester",
        meta: {
          title: t("columns.requester"),
          sortKey: "requester",
          cellClassName: "text-xs text-zinc-500 dark:text-zinc-400",
        },
        cell: ({ row }) => row.original.requestedByEmail,
      },
      {
        id: "ticket",
        meta: { title: t("columns.ticket"), cellClassName: "text-xs" },
        cell: ({ row }) => (
          <Link
            href={`/admin/tickets/${row.original.ticketId}`}
            className="font-mono text-blue-600 hover:underline dark:text-blue-400"
          >
            {row.original.ticketNumber ?? ""}
          </Link>
        ),
      },
      {
        id: "created",
        meta: {
          title: t("columns.createdAt"),
          sortKey: "created",
          filter: { kind: "dateRange", fromParam: "from", toParam: "to" },
          cellClassName: "text-xs text-zinc-500 dark:text-zinc-400",
        },
        cell: ({ row }) => row.original.createdLabel,
      },
      {
        id: "actions",
        meta: { title: tCommon("actions"), sticky: true },
        cell: ({ row }) => (
          <ProcurementRowActions
            request={{
              id: row.original.id,
              itemName: row.original.itemName,
              quantity: row.original.quantity,
              type: row.original.type,
              status: row.original.status,
              estimatedCost: row.original.estimatedCost,
              requestedByEmail: row.original.requestedByEmail,
              ticketId: row.original.ticketId,
              ticketNumber: row.original.ticketNumber,
              createdAt: row.original.createdAt,
            }}
          />
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
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
