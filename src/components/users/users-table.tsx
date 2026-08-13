"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { UserRowActions } from "@/components/users/user-row-actions";
import { bulkResendCustomerInvites } from "@/app/actions/users";
import type { InviteStatus } from "@/lib/users/invite-status";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  roles: { id: string; name: string }[];
  createdAt: Date;
  createdLabel: string;
  inviteStatus: InviteStatus;
};

// Badge for every non-"active" invite state — "invite_failed" gets its own
// distinct (still red) label from "invite_expired": one means the customer
// never got the email at all, the other means they got it and didn't click
// in time. Different admin triage, same fix (resend).
const INVITE_BADGE_CLASS: Record<Exclude<InviteStatus, "active">, string> = {
  invited:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  invite_expired:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  invite_failed:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
};
const INVITE_BADGE_KEY: Record<Exclude<InviteStatus, "active">, string> = {
  invited: "inviteStatusInvited",
  invite_expired: "inviteStatusExpired",
  invite_failed: "inviteStatusFailed",
};

export function UsersTable({
  data,
  totalItems,
  pageSize,
  emptyMessage,
  currentUserId,
  allRoles,
  canEdit,
  canDeactivate,
  canReactivate,
  /** Adds a checkbox column + bulk "Resend invite" bar — for the External
   *  (customer) tab, where invite/reset resends are the whole point of
   *  filtering by invite status in the first place. */
  enableBulkActions = false,
}: {
  data: UserRow[];
  totalItems: number;
  pageSize: number;
  emptyMessage: string;
  currentUserId: string;
  allRoles: { id: string; name: string }[];
  canEdit: boolean;
  canDeactivate: boolean;
  canReactivate: boolean;
  enableBulkActions?: boolean;
}) {
  const t = useTranslations("users.list");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [resending, startResend] = useTransition();
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  function toggleSelected(id: string, checked: boolean) {
    setResultMessage(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setResultMessage(null);
  }

  function resendSelected() {
    const ids = [...selectedIds];
    startResend(async () => {
      const res = await bulkResendCustomerInvites(ids);
      if (!res.ok) {
        setResultMessage(res.error);
        return;
      }
      setResultMessage(t("bulkResendResult", { sent: res.sent, failed: res.failed }));
      setSelectedIds(new Set());
      router.refresh();
    });
  }

  const columns = useMemo<ColumnDef<UserRow>[]>(
    () => [
      ...(enableBulkActions
        ? [
            {
              id: "select",
              meta: { title: "", headClassName: "w-10 px-2", cellClassName: "px-2" },
              cell: ({ row }: { row: { original: UserRow } }) => (
                <input
                  type="checkbox"
                  checked={selectedIds.has(row.original.id)}
                  onChange={(e) => toggleSelected(row.original.id, e.target.checked)}
                  aria-label={t("selectRowLabel", { name: row.original.name })}
                  className="size-4 accent-blue-600"
                />
              ),
            } satisfies ColumnDef<UserRow>,
          ]
        : []),
      {
        id: "name",
        meta: {
          title: t("columns.name"),
          sortKey: "name",
          headClassName: "px-4",
          cellClassName: "px-4",
        },
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Link
              href={`/admin/users/${row.original.id}`}
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              {row.original.name}
            </Link>
            {row.original.id === currentUserId ? (
              <span className="inline-flex items-center rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
                {t("selfBadge")}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "email",
        meta: {
          title: t("columns.email"),
          sortKey: "email",
          cellClassName: "text-sm text-zinc-600 dark:text-zinc-300",
        },
        cell: ({ row }) => row.original.email,
      },
      {
        id: "roles",
        meta: {
          title: t("columns.roles"),
          sortKey: "roles",
          filter: {
            kind: "enum",
            param: "roleId",
            searchable: true,
            options: [
              ...allRoles.map((r) => ({ value: r.id, label: r.name })),
            ],
          },
          cellClassName: "text-xs",
        },
        cell: ({ row }) =>
          row.original.roles.length > 0 ? (
            <span>{row.original.roles.map((r) => r.name).join(", ")}</span>
          ) : (
            <span className="text-zinc-400">{t("noRoles")}</span>
          ),
      },
      {
        id: "status",
        meta: { title: t("columns.status"), sortKey: "status" },
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1">
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                row.original.isActive
                  ? "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300"
                  : "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
              }`}
            >
              {row.original.isActive
                ? t("filterStatusActive")
                : t("filterStatusInactive")}
            </span>
            {row.original.isActive && row.original.inviteStatus !== "active" ? (
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${INVITE_BADGE_CLASS[row.original.inviteStatus]}`}
              >
                {t(INVITE_BADGE_KEY[row.original.inviteStatus])}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "createdAt",
        meta: {
          title: t("columns.createdAt"),
          sortKey: "createdAt",
          cellClassName: "text-xs text-zinc-500 dark:text-zinc-400",
        },
        cell: ({ row }) => row.original.createdLabel,
      },
      {
        id: "actions",
        meta: { title: tCommon("actions"), sticky: true },
        cell: ({ row }) => (
          <UserRowActions
            user={row.original}
            isSelf={row.original.id === currentUserId}
            canEdit={canEdit}
            canDeactivate={canDeactivate}
            canReactivate={canReactivate}
            allRoles={allRoles}
          />
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUserId, allRoles, canEdit, canDeactivate, canReactivate, enableBulkActions, selectedIds],
  );

  return (
    <div className="space-y-2">
      {enableBulkActions && selectedIds.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm dark:border-blue-900 dark:bg-blue-950/40">
          <span className="font-medium text-blue-900 dark:text-blue-200">
            {t("bulkSelectedCount", { count: selectedIds.size })}
          </span>
          <Button size="sm" onClick={resendSelected} disabled={resending}>
            {resending ? t("bulkResending") : t("bulkResendButton")}
          </Button>
          <Button size="sm" variant="outline" onClick={clearSelection} disabled={resending}>
            {t("bulkClearSelection")}
          </Button>
          {resultMessage ? (
            <span role="status" className="text-blue-800 dark:text-blue-300">
              {resultMessage}
            </span>
          ) : null}
        </div>
      ) : null}
      <DataTable
        columns={columns}
        data={data}
        totalItems={totalItems}
        pageSize={pageSize}
        emptyMessage={emptyMessage}
      />
    </div>
  );
}
