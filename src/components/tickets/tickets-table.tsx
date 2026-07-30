"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { DataTable } from "@/components/ui/data-table";
import type { FilterOption } from "@/components/ui/data-table-column-header";
import {
  BillingBadge,
  CategoryBadge,
  EscalatedBadge,
  PriorityBadge,
  StatusBadge,
  TypeBadge,
} from "@/components/tickets/badges";
import { TicketRowActions } from "@/components/tickets/ticket-row-actions";
import type { AssignableTechnician } from "@/lib/tickets/load";
import { BILLING_FILTER_VALUES } from "@/lib/tickets/billing-status";

// Row view-model: raw values for the badges/row-actions, plus server-formatted
// date strings (so no `Date.now()` runs during client render — avoids a
// hydration mismatch on the relative "updated" label).
export type TicketRow = {
  id: string;
  ticketNumber: string;
  subject: string;
  type: string;
  typeLabel: string;
  category: string;
  categoryLabel: string;
  status: string;
  priority: string;
  isEscalated: boolean;
  billable: string | null;
  invoiceNumber: string | null;
  customerName: string;
  customerEmail: string;
  organizationName: string | null;
  customerCompany: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdLabel: string;
  updatedLabel: string;
};

const PRIORITIES = ["low", "medium", "high", "critical"];
const STATUSES = [
  "open",
  "in_progress",
  "awaiting_customer_confirmation",
  "on_hold",
  "resolved",
  "closed",
];

export function TicketsTable({
  data,
  totalItems,
  pageSize,
  emptyMessage,
  technicians,
  organizations,
  customers,
  categories,
  types,
  canAssign,
  canDelete,
}: {
  data: TicketRow[];
  totalItems: number;
  pageSize: number;
  emptyMessage: string;
  technicians: AssignableTechnician[];
  organizations: { id: string; name: string }[];
  customers: { email: string; name: string }[];
  categories: { value: string; label: string }[];
  types: { value: string; label: string }[];
  canAssign: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations("tickets.queue");
  const tCommon = useTranslations("common");
  const tStatus = useTranslations("tickets.status");
  const tPriority = useTranslations("tickets.priority");
  const tBillingOpt = useTranslations("tickets.filters.billingOptions");
  const tFilters = useTranslations("tickets.filters");

  const columns = useMemo<ColumnDef<TicketRow>[]>(() => {
    const categoryOpts: FilterOption[] = categories.map((c) => ({
      value: c.value,
      label: c.label,
    }));
    const typeOpts: FilterOption[] = types.map((tp) => ({
      value: tp.value,
      label: tp.label,
    }));
    const priorityOpts: FilterOption[] = PRIORITIES.map((v) => ({
      value: v,
      label: tPriority(v),
    }));
    const statusOpts: FilterOption[] = STATUSES.map((v) => ({
      value: v,
      label: tStatus(v),
    }));
    const billingOpts: FilterOption[] = BILLING_FILTER_VALUES.map((v) => ({
      value: v,
      label: tBillingOpt(v),
    }));
    const orgOpts: FilterOption[] = [
      ...organizations.map((o) => ({ value: o.id, label: o.name })),
    ];
    const customerOpts: FilterOption[] = [
      ...customers.map((c) => ({
        value: c.email,
        label: c.name && c.name !== c.email ? `${c.name} · ${c.email}` : c.email,
      })),
    ];
    const assigneeOpts: FilterOption[] = [
      { value: "unassigned", label: tFilters("unassigned") },
      ...technicians.map((tech) => ({ value: tech.id, label: tech.name })),
    ];

    return [
      {
        id: "ticket",
        meta: {
          title: t("columns.ticket"),
          sortKey: "ticket",
          headClassName: "px-4",
          cellClassName: "px-4 font-mono text-xs",
        },
        cell: ({ row }) => (
          <Link
            href={`/admin/tickets/${row.original.id}`}
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            {row.original.ticketNumber}
          </Link>
        ),
      },
      {
        id: "subject",
        meta: {
          title: t("columns.subject"),
          sortKey: "subject",
          cellClassName: "max-w-xs truncate",
        },
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            {row.original.isEscalated ? <EscalatedBadge /> : null}
            <span>{row.original.subject}</span>
          </div>
        ),
      },
      {
        id: "type",
        meta: {
          title: t("columns.type"),
          sortKey: "type",
          filter: { kind: "enum", param: "type", options: typeOpts },
        },
        cell: ({ row }) => (
          <TypeBadge type={row.original.type} label={row.original.typeLabel} />
        ),
      },
      {
        id: "category",
        meta: {
          title: t("columns.category"),
          sortKey: "category",
          filter: { kind: "enum", param: "category", options: categoryOpts },
        },
        cell: ({ row }) => (
          <CategoryBadge
            category={row.original.category}
            label={row.original.categoryLabel}
          />
        ),
      },
      {
        id: "priority",
        meta: {
          title: t("columns.priority"),
          sortKey: "priority",
          filter: { kind: "enum", param: "priority", options: priorityOpts },
        },
        cell: ({ row }) => <PriorityBadge priority={row.original.priority} />,
      },
      {
        id: "status",
        meta: {
          title: t("columns.status"),
          sortKey: "status",
          filter: { kind: "enum", param: "status", options: statusOpts },
        },
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "billing",
        meta: {
          title: t("columns.billing"),
          sortKey: "billing",
          filter: { kind: "enum", param: "billing", options: billingOpts },
        },
        cell: ({ row }) => (
          <BillingBadge
            billable={row.original.billable}
            invoiceNumber={row.original.invoiceNumber}
          />
        ),
      },
      {
        id: "customer",
        meta: {
          title: t("columns.customer"),
          sortKey: "customer",
          filter: {
            kind: "enum",
            param: "customer",
            options: customerOpts,
            searchable: true,
          },
          cellClassName: "text-sm",
        },
        cell: ({ row }) => (
          <>
            <div>{row.original.customerName}</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {row.original.customerEmail}
            </div>
          </>
        ),
      },
      {
        id: "organization",
        meta: {
          title: t("columns.organization"),
          sortKey: "organization",
          filter: {
            kind: "enum",
            param: "org",
            options: orgOpts,
            searchable: true,
          },
          cellClassName: "text-sm",
        },
        cell: ({ row }) =>
          row.original.organizationName ? (
            <>{row.original.organizationName}</>
          ) : row.original.customerCompany ? (
            <span className="text-zinc-500 dark:text-zinc-400">
              {row.original.customerCompany}
              <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] uppercase tracking-wide text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                {t("orgUnverified")}
              </span>
            </span>
          ) : (
            <span className="text-zinc-400">—</span>
          ),
      },
      {
        id: "assignee",
        meta: {
          title: t("columns.assignee"),
          sortKey: "assignee",
          filter: {
            kind: "enum",
            param: "assignee",
            options: assigneeOpts,
            searchable: true,
          },
          cellClassName: "text-sm",
        },
        cell: ({ row }) =>
          row.original.assignedToName ?? (
            <span className="text-zinc-400">{t("unassigned")}</span>
          ),
      },
      {
        id: "created",
        meta: {
          title: t("columns.created"),
          sortKey: "created",
          filter: { kind: "dateRange", fromParam: "from", toParam: "to" },
          cellClassName: "text-xs text-zinc-500 dark:text-zinc-400",
        },
        cell: ({ row }) => row.original.createdLabel,
      },
      {
        id: "updated",
        meta: {
          title: t("columns.updated"),
          sortKey: "updated",
          cellClassName: "text-xs text-zinc-500 dark:text-zinc-400",
        },
        cell: ({ row }) => row.original.updatedLabel,
      },
      {
        id: "actions",
        meta: { title: tCommon("actions"), sticky: true },
        cell: ({ row }) => (
          <TicketRowActions
            ticket={row.original}
            technicians={technicians}
            canAssign={canAssign}
            canEdit={canAssign}
            canDelete={canDelete}
          />
        ),
      },
    ];
    // Options depend only on the passed lists + translators (stable per render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    technicians,
    organizations,
    customers,
    categories,
    types,
    canAssign,
    canDelete,
  ]);

  return (
    <DataTable
      columns={columns}
      data={data}
      totalItems={totalItems}
      pageSize={pageSize}
      rowPx={57}
      emptyMessage={emptyMessage}
    />
  );
}
