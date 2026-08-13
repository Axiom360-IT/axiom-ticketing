"use client";

import { useMemo, useState, useTransition } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Pencil, Power, Star, Trash2 } from "lucide-react";
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
import { TicketTypeIconPicker } from "@/components/settings/ticket-type-icon-picker";
import { DEFAULT_TICKET_TYPE_ICON } from "@/lib/tickets/type-icon-keys";
import { cn } from "@/lib/utils";
import {
  createCategory,
  deleteCategory,
  moveCategory,
  renameCategory,
  setCategoryActive,
  setDefaultCategory,
} from "@/app/actions/categories";
import {
  createType,
  deleteType,
  moveType,
  renameType,
  setTypeActive,
  setDefaultType,
} from "@/app/actions/ticket-types";

type Result = { ok: true } | { ok: false; error: string };

export type TaxonomyRow = {
  id: string;
  value: string;
  label: string;
  /** Only present for `kind: "type"` — categories have no icon column. */
  icon?: string;
  sortOrder: number;
  isActive: boolean;
  isDefault: boolean;
  inUse: number;
  isFirst: boolean;
  isLast: boolean;
};

type Kind = "category" | "type";

// Bind the right server-action set per kind so one grid serves both.
const ACTIONS: Record<
  Kind,
  {
    create: (label: string, icon?: string) => Promise<Result>;
    rename: (id: string, label: string, icon?: string) => Promise<Result>;
    setActive: (id: string, isActive: boolean) => Promise<Result>;
    setDefault: (id: string) => Promise<Result>;
    move: (id: string, dir: "up" | "down") => Promise<Result>;
    del: (id: string) => Promise<Result>;
  }
> = {
  category: {
    create: createCategory,
    rename: renameCategory,
    setActive: setCategoryActive,
    setDefault: setDefaultCategory,
    move: moveCategory,
    del: deleteCategory,
  },
  type: {
    create: createType,
    rename: renameType,
    setActive: setTypeActive,
    setDefault: setDefaultType,
    move: moveType,
    del: deleteType,
  },
};

export function TaxonomyTable({
  kind,
  namespace,
  data,
  totalItems,
  pageSize,
  emptyMessage,
  canManage,
}: {
  kind: Kind;
  namespace: string;
  data: TaxonomyRow[];
  totalItems: number;
  pageSize: number;
  emptyMessage: string;
  canManage: boolean;
}) {
  const t = useTranslations(namespace);
  const tCommon = useTranslations("common");

  const columns = useMemo<ColumnDef<TaxonomyRow>[]>(
    () => [
      {
        id: "order",
        meta: {
          title: t("columns.order"),
          headClassName: "w-14 px-4",
          cellClassName: "px-4",
        },
        cell: ({ row }) => (
          <OrderCell
            kind={kind}
            row={row.original}
            canManage={canManage}
            upLabel={t("moveUp")}
            downLabel={t("moveDown")}
          />
        ),
      },
      {
        id: "name",
        meta: {
          title: t("columns.name"),
          headClassName: "px-4",
          cellClassName: "px-4",
        },
        cell: ({ row }) => (
          <span
            className={
              row.original.isActive
                ? "font-medium text-zinc-900 dark:text-zinc-50"
                : "font-medium text-zinc-400 line-through"
            }
          >
            {row.original.label}
          </span>
        ),
      },
      {
        id: "slug",
        meta: {
          title: t("columns.slug"),
          cellClassName: "font-mono text-xs text-zinc-500 dark:text-zinc-400",
        },
        cell: ({ row }) => row.original.value,
      },
      {
        id: "default",
        meta: { title: t("columns.default") },
        cell: ({ row }) =>
          row.original.isDefault ? (
            <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              <Star className="size-3" aria-hidden="true" />
              {t("default")}
            </span>
          ) : null,
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
          title: t("columns.tickets"),
          cellClassName:
            "text-xs text-zinc-500 dark:text-zinc-400 tabular-nums",
        },
        cell: ({ row }) => row.original.inUse,
      },
      {
        id: "actions",
        meta: { title: tCommon("actions"), sticky: true },
        cell: ({ row }) =>
          canManage ? (
            <RowActions kind={kind} namespace={namespace} row={row.original} />
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, namespace, canManage],
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

function OrderCell({
  kind,
  row,
  canManage,
  upLabel,
  downLabel,
}: {
  kind: Kind;
  row: TaxonomyRow;
  canManage: boolean;
  upLabel: string;
  downLabel: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const move = ACTIONS[kind].move;
  if (!canManage) return null;
  const go = (dir: "up" | "down") =>
    start(async () => {
      await move(row.id, dir);
      router.refresh();
    });
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => go("up")}
        disabled={pending || row.isFirst}
        aria-label={upLabel}
        className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ArrowUp className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => go("down")}
        disabled={pending || row.isLast}
        aria-label={downLabel}
        className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ArrowDown className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

const ICON_BTN =
  "inline-flex h-9 w-9 sm:h-8 sm:w-8 items-center justify-center rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40 disabled:pointer-events-none";

function RowActions({
  kind,
  namespace,
  row,
}: {
  kind: Kind;
  namespace: string;
  row: TaxonomyRow;
}) {
  const t = useTranslations(namespace);
  const router = useRouter();
  const a = ACTIONS[kind];
  const [pending, start] = useTransition();
  const [renameOpen, setRenameOpen] = useState(false);
  const [label, setLabel] = useState(row.label);
  const [icon, setIcon] = useState(row.icon ?? DEFAULT_TICKET_TYPE_ICON);
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
      {!row.isDefault ? (
        <button
          type="button"
          onClick={() => run(() => a.setDefault(row.id))}
          disabled={pending}
          title={t("makeDefault")}
          aria-label={t("makeDefault")}
          className={cn(
            ICON_BTN,
            "text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950",
          )}
        >
          <Star className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
      {!row.isDefault ? (
        <button
          type="button"
          onClick={() => run(() => a.setActive(row.id, !row.isActive))}
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
      ) : null}

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
          <div className="flex items-center gap-2">
            {kind === "type" ? (
              <TicketTypeIconPicker
                value={icon}
                onChange={setIcon}
                label={t("iconLabel")}
              />
            ) : null}
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={40}
              aria-label={t("editLabel")}
              autoFocus
              className="flex-1"
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose
              render={<Button variant="outline">{t("cancel")}</Button>}
            />
            <Button
              disabled={pending || !label.trim()}
              onClick={() =>
                run(
                  () =>
                    a.rename(
                      row.id,
                      label.trim(),
                      kind === "type" ? icon : undefined,
                    ),
                  () => setRenameOpen(false),
                )
              }
            >
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!row.isDefault && row.inUse === 0 ? (
        <button
          type="button"
          onClick={() => run(() => a.del(row.id))}
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
