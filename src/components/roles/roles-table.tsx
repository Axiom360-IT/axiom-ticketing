"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { RoleRowActions } from "@/components/roles/role-row-actions";

export type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
  /** May the viewer change this role (they strictly outrank it)? */
  manageable: boolean;
  /** Ranked above the viewer — only ever true under the `locked` policy, since
   *  `hidden` drops such roles from the list entirely. */
  locked: boolean;
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
          <span className="inline-flex items-center gap-1.5">
            <Link
              href={`/admin/roles/${row.original.id}`}
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              {row.original.name}
            </Link>
            {row.original.locked ? (
              <Lock
                className="size-3 text-amber-600 dark:text-amber-400"
                aria-label={tCommon("restricted")}
              />
            ) : null}
          </span>
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
