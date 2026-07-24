"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { DataTable } from "@/components/ui/data-table";
import { RoleRowActions } from "@/components/roles/role-row-actions";

export type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
};

export function RolesTable({
  data,
  totalItems,
  pageSize,
  emptyMessage,
  canEdit,
  canDelete,
}: {
  data: RoleRow[];
  totalItems: number;
  pageSize: number;
  emptyMessage: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations("roles.list");
  const tCommon = useTranslations("common");

  const columns = useMemo<ColumnDef<RoleRow>[]>(
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
            href={`/admin/roles/${row.original.id}`}
            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: "users",
        meta: {
          title: t("columns.users"),
          sortKey: "users",
          cellClassName: "text-xs text-zinc-500 dark:text-zinc-400",
        },
        cell: ({ row }) => t("userCount", { count: row.original.userCount }),
      },
      {
        id: "description",
        meta: {
          title: t("columns.description"),
          sortKey: "description",
          cellClassName: "text-xs text-zinc-500 dark:text-zinc-400",
        },
        cell: ({ row }) => row.original.description ?? "",
      },
      {
        id: "actions",
        meta: { title: tCommon("actions"), sticky: true },
        cell: ({ row }) => (
          <RoleRowActions
            role={row.original}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        ),
      },
    ],
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
