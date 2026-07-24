"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Column, RowData } from "@tanstack/react-table";
import { Popover } from "@base-ui/react/popover";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronsUpDown,
  Search,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

// ── Column filter descriptors ─────────────────────────────────────────
// A column declares its filter via `meta.filter`; the header renders the right
// control and writes the value straight into the URL (so the server re-queries
// and the state stays bookmarkable). Every filter kind maps to one or two
// existing query params, so no backend param renames are needed.

export type FilterOption = { value: string; label: string };
export type ColumnFilter =
  /** Multi-select (checkboxes) stored as a CSV param, e.g.
   *  `organization=<id1>,<id2>`. `searchable` adds a filter box for long lists.
   *  The server reads the CSV and matches with `IN (...)`. */
  | {
      kind: "enum";
      param: string;
      options: FilterOption[];
      searchable?: boolean;
    }
  /** Free-text substring match on a single param. */
  | { kind: "text"; param: string; placeholder?: string }
  /** Inclusive date range across two params (YYYY-MM-DD). */
  | { kind: "dateRange"; fromParam: string; toParam: string };

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Header label (used by the generic header + as the aria title). */
    title?: string;
    /** `?sort=` id if the column is sortable; omit to disable sorting. */
    sortKey?: string;
    /** Column filter descriptor; omit for a non-filterable column. */
    filter?: ColumnFilter;
    /** Extra classes for the <th>/<td>. */
    headClassName?: string;
    cellClassName?: string;
    /** Right-pinned actions column. */
    sticky?: boolean;
  }
}

// ── URL helper ────────────────────────────────────────────────────────

function useTableParams() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const push = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") params.delete(k);
      else params.set(k, v);
    }
    // Any sort/filter change returns to page 1 — the current offset may now be
    // past the end of the narrowed result set.
    params.delete("page");
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  };
  return { sp, push, pending };
}

function filterIsActive(
  filter: ColumnFilter,
  sp: URLSearchParams | ReturnType<typeof useSearchParams>,
): boolean {
  if (filter.kind === "dateRange") {
    return Boolean(sp.get(filter.fromParam) || sp.get(filter.toParam));
  }
  return Boolean(sp.get(filter.param));
}

function clearPatch(filter: ColumnFilter): Record<string, null> {
  return filter.kind === "dateRange"
    ? { [filter.fromParam]: null, [filter.toParam]: null }
    : { [filter.param]: null };
}

// ── Header ────────────────────────────────────────────────────────────

export function DataTableColumnHeader<TData, TValue>({
  column,
}: {
  column: Column<TData, TValue>;
}) {
  const meta = column.columnDef.meta;
  const title = meta?.title ?? "";
  const sortKey = meta?.sortKey;
  const filter = meta?.filter;
  const t = useTranslations("common.dataTable");
  const { sp, push } = useTableParams();

  // Plain header when there's nothing to interact with.
  if (!sortKey && !filter) {
    return <span>{title}</span>;
  }

  const rawSort = sp.get("sort");
  const [sortId, sortDir] = rawSort ? rawSort.split(":") : [null, null];
  const activeSort =
    sortKey && sortId === sortKey
      ? sortDir === "asc"
        ? "asc"
        : "desc"
      : null;
  const filtered = filter ? filterIsActive(filter, sp) : false;

  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <button
            type="button"
            className={cn(
              "-ml-1.5 inline-flex items-center gap-1 rounded px-1.5 py-1 text-left font-medium whitespace-nowrap transition-colors",
              "hover:bg-zinc-100 dark:hover:bg-zinc-800",
              (activeSort || filtered) && "text-blue-600 dark:text-blue-400",
            )}
          >
            <span>{title}</span>
            {activeSort === "asc" ? (
              <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : activeSort === "desc" ? (
              <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <ChevronsUpDown
                className="h-3.5 w-3.5 shrink-0 opacity-40"
                aria-hidden="true"
              />
            )}
            {filtered ? (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500"
                aria-hidden="true"
              />
            ) : null}
          </button>
        }
      />
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="z-50">
          <Popover.Popup className="z-50 min-w-52 max-w-72 rounded-md border border-zinc-200 bg-white p-1 shadow-lg outline-none dark:border-zinc-800 dark:bg-zinc-950">
            {sortKey ? (
              <div className="flex flex-col">
                <SortItem
                  icon={<ArrowUp className="h-4 w-4" aria-hidden="true" />}
                  label={t("sortAsc")}
                  active={activeSort === "asc"}
                  onClick={() =>
                    push({
                      sort: activeSort === "asc" ? null : `${sortKey}:asc`,
                    })
                  }
                />
                <SortItem
                  icon={<ArrowDown className="h-4 w-4" aria-hidden="true" />}
                  label={t("sortDesc")}
                  active={activeSort === "desc"}
                  onClick={() =>
                    push({
                      sort: activeSort === "desc" ? null : `${sortKey}:desc`,
                    })
                  }
                />
              </div>
            ) : null}

            {sortKey && filter ? (
              <div className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" />
            ) : null}

            {filter ? (
              <ColumnFilterControl filter={filter} sp={sp} push={push} />
            ) : null}

            {filtered && filter ? (
              <>
                <div className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" />
                <button
                  type="button"
                  onClick={() => push(clearPatch(filter))}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  {t("clearFilter")}
                </button>
              </>
            ) : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SortItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    // Popover.Close so choosing a sort closes the menu; filter controls stay open.
    <Popover.Close
      render={
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800",
            active
              ? "font-medium text-blue-600 dark:text-blue-400"
              : "text-zinc-700 dark:text-zinc-200",
          )}
        >
          {icon}
          <span className="flex-1 text-left">{label}</span>
          {active ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
        </button>
      }
    />
  );
}

// ── Filter controls ───────────────────────────────────────────────────

type PushFn = (patch: Record<string, string | null>) => void;

function ColumnFilterControl({
  filter,
  sp,
  push,
}: {
  filter: ColumnFilter;
  sp: ReturnType<typeof useSearchParams>;
  push: PushFn;
}) {
  switch (filter.kind) {
    case "enum":
      return <EnumFilter filter={filter} sp={sp} push={push} />;
    case "text":
      return <TextFilter filter={filter} sp={sp} push={push} />;
    case "dateRange":
      return <DateRangeFilter filter={filter} sp={sp} push={push} />;
  }
}

const OPTION_CLASS =
  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800";

function EnumFilter({
  filter,
  sp,
  push,
}: {
  filter: Extract<ColumnFilter, { kind: "enum" }>;
  sp: ReturnType<typeof useSearchParams>;
  push: PushFn;
}) {
  const t = useTranslations("common.dataTable");
  const selected = new Set(
    (sp.get(filter.param) ?? "").split(",").filter(Boolean),
  );
  const [query, setQuery] = useState("");
  const options = useMemo(() => {
    if (!filter.searchable || !query.trim()) return filter.options;
    const q = query.trim().toLowerCase();
    return filter.options.filter((o) => o.label.toLowerCase().includes(q));
  }, [filter.options, filter.searchable, query]);

  function set(values: Set<string>) {
    push({ [filter.param]: values.size ? [...values].join(",") : null });
  }
  function toggle(value: string) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    set(next);
  }

  return (
    <div>
      {filter.searchable ? (
        <div className="mb-1 flex items-center gap-2 border-b border-zinc-100 px-2 pb-1 dark:border-zinc-800">
          <Search className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchOptions")}
            className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-zinc-400"
          />
        </div>
      ) : null}

      {/* Select-all / clear affordance for the (filtered) options. */}
      <div className="flex items-center justify-between px-2 pb-1 text-[11px] text-zinc-500 dark:text-zinc-400">
        <button
          type="button"
          className="rounded px-1 py-0.5 hover:text-blue-600 dark:hover:text-blue-400"
          onClick={() =>
            set(new Set([...selected, ...options.map((o) => o.value)]))
          }
        >
          {t("selectAll")}
        </button>
        {selected.size > 0 ? (
          <button
            type="button"
            className="rounded px-1 py-0.5 hover:text-blue-600 dark:hover:text-blue-400"
            onClick={() => set(new Set())}
          >
            {t("clearSelection", { count: selected.size })}
          </button>
        ) : null}
      </div>

      <div className="max-h-64 overflow-y-auto">
        {options.map((o) => {
          const on = selected.has(o.value);
          return (
            <label key={o.value} className={OPTION_CLASS}>
              <span
                className={cn(
                  "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                  on
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-zinc-300 dark:border-zinc-600",
                )}
              >
                {on ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
              </span>
              <input
                type="checkbox"
                className="sr-only"
                checked={on}
                onChange={() => toggle(o.value)}
              />
              <span className="flex-1 truncate">{o.label}</span>
            </label>
          );
        })}
        {options.length === 0 ? (
          <p className="px-2 py-3 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {t("noMatches")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function TextFilter({
  filter,
  sp,
  push,
}: {
  filter: Extract<ColumnFilter, { kind: "text" }>;
  sp: ReturnType<typeof useSearchParams>;
  push: PushFn;
}) {
  const initial = sp.get(filter.param) ?? "";
  const [value, setValue] = useState(initial);
  // Debounce writes so each keystroke doesn't push a URL/refetch.
  useEffect(() => {
    if (value === initial) return;
    const id = setTimeout(() => push({ [filter.param]: value.trim() || null }), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="p-1">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={filter.placeholder}
        className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
      />
    </div>
  );
}

function DateRangeFilter({
  filter,
  sp,
  push,
}: {
  filter: Extract<ColumnFilter, { kind: "dateRange" }>;
  sp: ReturnType<typeof useSearchParams>;
  push: PushFn;
}) {
  const t = useTranslations("common.dataTable");
  const from = sp.get(filter.fromParam) ?? "";
  const to = sp.get(filter.toParam) ?? "";
  return (
    <div className="flex flex-col gap-2 p-1">
      <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
        {t("from")}
        <input
          type="date"
          value={from}
          onChange={(e) => push({ [filter.fromParam]: e.target.value || null })}
          className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
        {t("to")}
        <input
          type="date"
          value={to}
          onChange={(e) => push({ [filter.toParam]: e.target.value || null })}
          className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
    </div>
  );
}
