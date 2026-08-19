"use client";

import { useMemo, useState, useTransition } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Pencil, Power, Trash2 } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  deleteVendor,
  renameVendor,
  setVendorActive,
  type AdminVendor,
} from "@/app/actions/vendors";

type Result = { ok: true } | { ok: false; error: string };

export type VendorRow = AdminVendor;

export function VendorTable({
  data,
  totalItems,
  pageSize,
  emptyMessage,
  canManage,
}: {
  data: VendorRow[];
  totalItems: number;
  pageSize: number;
  emptyMessage: string;
  canManage: boolean;
}) {
  const t = useTranslations("vendors");
  const tCommon = useTranslations("common");

  const columns = useMemo<ColumnDef<VendorRow>[]>(
    () => [
      {
        id: "name",
        meta: { title: t("columns.name"), headClassName: "px-4", cellClassName: "px-4" },
        cell: ({ row }) => (
          <span
            className={
              row.original.isActive
                ? "font-medium text-zinc-900 dark:text-zinc-50"
                : "font-medium text-zinc-400 line-through"
            }
          >
            {row.original.name}
          </span>
        ),
      },
      {
        id: "status",
        meta: {
          title: t("columns.status"),
          cellClassName: "text-xs",
          filter: {
            kind: "enum",
            param: "status",
            options: [
              { value: "active", label: t("statusActive") },
              { value: "inactive", label: t("statusInactive") },
            ],
          },
        },
        cell: ({ row }) =>
          row.original.isActive ? (
            <span className="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
              {t("statusActive")}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              {t("statusInactive")}
            </span>
          ),
      },
      {
        id: "inUse",
        meta: {
          title: t("columns.requests"),
          cellClassName: "text-xs text-zinc-500 dark:text-zinc-400 tabular-nums",
        },
        cell: ({ row }) => row.original.inUse,
      },
      {
        id: "actions",
        meta: { title: tCommon("actions"), sticky: true },
        cell: ({ row }) => (canManage ? <RowActions row={row.original} /> : null),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canManage],
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

const ICON_BTN =
  "inline-flex h-9 w-9 sm:h-8 sm:w-8 items-center justify-center rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40 disabled:pointer-events-none";

function RowActions({ row }: { row: VendorRow }) {
  const t = useTranslations("vendors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState(row.name);
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<Result>, onOk?: () => void) {
    setError(null);
    start(async () => {
      const res = await action();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onOk?.();
      router.refresh();
    });
  }

  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => run(() => setVendorActive(row.id, !row.isActive))}
        disabled={pending}
        title={row.isActive ? t("deactivate") : t("activate")}
        aria-label={row.isActive ? t("deactivate") : t("activate")}
        className={cn(
          ICON_BTN,
          "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
        )}
      >
        <Power className="h-4 w-4" aria-hidden="true" />
      </button>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogTrigger
          render={
            <button
              type="button"
              title={t("rename")}
              aria-label={t("rename")}
              className={cn(
                ICON_BTN,
                "text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950",
              )}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </button>
          }
        />
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("renameTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            aria-label={t("editLabel")}
            autoFocus
          />
          {error ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button variant="outline">{t("cancel")}</Button>} />
            <Button
              disabled={pending || !name.trim()}
              onClick={() =>
                run(
                  () => renameVendor(row.id, name.trim()),
                  () => setRenameOpen(false),
                )
              }
            >
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {row.inUse === 0 ? (
        <button
          type="button"
          onClick={() => run(() => deleteVendor(row.id))}
          disabled={pending}
          title={t("delete")}
          aria-label={t("delete")}
          className={cn(
            ICON_BTN,
            "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950",
          )}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
