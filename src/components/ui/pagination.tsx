import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import { PageSizeSelect } from "./page-size-select";

// URL-driven pagination. Server-rendered (just Links — no client JS, except
// the rows-per-page <select>), preserves every other search param so a
// paginated link still carries the active filters / search query.
//
// Numbered pager (first / prev / 1 2 3 … / next / last) + a "N–M of T items"
// range on the right. Rendering the numbers and the range both require the
// TOTAL row count, so every caller passes `totalItems`: for LIMIT/OFFSET pages
// run a `count()` query alongside the page query; for pages that already
// materialise the full list in JS, `totalItems` is simply that list's length.

const PAGE_PARAM = "page";

type Props = {
  /** Path the link points back to (e.g. "/admin/tickets"). */
  pathname: string;
  /** Current `?page=` value (1-indexed). */
  page: number;
  /** Current `?pageSize=` value (rows per page). */
  pageSize: number;
  /** Total number of rows across every page (drives the numbers + range). */
  totalItems: number;
  /** All other current search params — preserved on every page link. */
  searchParams: ReadonlyURLSearchParams;
  /** Hide the entire bar when there's only one page total. Default `false` —
   *  the bar always renders so users see the affordance (and the range) even
   *  on a single-page list. */
  hideWhenSinglePage?: boolean;
  className?: string;
};

// Lightweight subset of `URLSearchParams` so the component can be
// rendered server-side without importing `next/navigation`'s client
// hook. Callers pass `new URLSearchParams(...)` made from awaited
// searchParams.
type ReadonlyURLSearchParams = Pick<
  URLSearchParams,
  "toString" | "set" | "delete" | "get"
>;

function buildHref(
  pathname: string,
  base: ReadonlyURLSearchParams,
  page: number,
): string {
  const params = new URLSearchParams(base.toString());
  if (page <= 1) {
    params.delete(PAGE_PARAM);
  } else {
    params.set(PAGE_PARAM, String(page));
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Build the numeric window: a run of at most `max` page numbers centered on
 *  the current page, with an ellipsis marker on whichever side is truncated.
 *  The first/last arrows handle jumping to the ends, so the boundary page
 *  numbers are intentionally NOT force-shown (matches the reference design). */
type PageToken = number | "ellipsis-start" | "ellipsis-end";
function pageTokens(current: number, totalPages: number, max = 5): PageToken[] {
  if (totalPages <= max) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const half = Math.floor((max - 1) / 2);
  const start = Math.min(Math.max(current - half, 1), totalPages - max + 1);
  const nums: PageToken[] = Array.from({ length: max }, (_, i) => start + i);
  if (start > 1) nums.unshift("ellipsis-start");
  if (start + max - 1 < totalPages) nums.push("ellipsis-end");
  return nums;
}

export async function Pagination({
  pathname,
  page,
  pageSize,
  totalItems,
  searchParams,
  hideWhenSinglePage = false,
  className,
}: Props) {
  const t = await getTranslations("common.pagination");

  const total = Math.max(0, totalItems);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Clamp the current page into range so a hand-edited `?page=999` still
  // renders a sane bar (the query already returned an empty slice).
  const current = Math.min(Math.max(page, 1), totalPages);

  if (hideWhenSinglePage && totalPages <= 1) return null;

  const isFirst = current <= 1;
  const isLast = current >= totalPages;
  const rangeStart = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const rangeEnd = Math.min(current * pageSize, total);

  return (
    <nav
      aria-label={t("label")}
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-3 text-sm",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1">
          <ArrowLink
            href={buildHref(pathname, searchParams, 1)}
            disabled={isFirst}
            label={t("first")}
          >
            <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
          </ArrowLink>
          <ArrowLink
            href={buildHref(pathname, searchParams, current - 1)}
            disabled={isFirst}
            label={t("previous")}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </ArrowLink>

          {/* Numbered pages — desktop. */}
          <div className="hidden items-center gap-1 sm:flex">
            {pageTokens(current, totalPages).map((token) =>
              typeof token === "number" ? (
                <NumberLink
                  key={token}
                  href={buildHref(pathname, searchParams, token)}
                  active={token === current}
                  label={t("goToPage", { page: token })}
                >
                  {token}
                </NumberLink>
              ) : (
                <span
                  key={token}
                  aria-hidden="true"
                  className="inline-flex h-9 w-9 items-center justify-center text-zinc-400 dark:text-zinc-600"
                >
                  …
                </span>
              ),
            )}
          </div>

          {/* Compact "Page X of Y" — mobile. */}
          <span className="px-2 text-xs text-zinc-500 sm:hidden dark:text-zinc-400">
            {t("pageOf", { page: current, total: totalPages })}
          </span>

          <ArrowLink
            href={buildHref(pathname, searchParams, current + 1)}
            disabled={isLast}
            label={t("next")}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </ArrowLink>
          <ArrowLink
            href={buildHref(pathname, searchParams, totalPages)}
            disabled={isLast}
            label={t("last")}
          >
            <ChevronsRight className="h-4 w-4" aria-hidden="true" />
          </ArrowLink>
        </div>

        <PageSizeSelect currentSize={pageSize} label={t("itemsPerPage")} />
      </div>

      <span className="text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
        {total === 0
          ? t("rangeEmpty", { total: 0 })
          : t("range", { start: rangeStart, end: rangeEnd, total })}
      </span>
    </nav>
  );
}

// ── Link primitives ──────────────────────────────────────────────────

const CELL =
  "inline-flex items-center justify-center min-h-[36px] min-w-[36px] rounded-md border text-sm transition-colors";

function ArrowLink({
  href,
  disabled,
  label,
  children,
}: {
  href: string;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        aria-label={label}
        className={cn(
          CELL,
          "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-700",
        )}
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        CELL,
        "border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50",
      )}
    >
      {children}
    </Link>
  );
}

function NumberLink({
  href,
  active,
  label,
  children,
}: {
  href: string;
  active: boolean;
  label: string;
  children: React.ReactNode;
}) {
  if (active) {
    return (
      <span
        aria-current="page"
        className={cn(
          CELL,
          "border-zinc-200 bg-zinc-100 font-semibold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50",
        )}
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        CELL,
        "border-transparent text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50",
      )}
    >
      {children}
    </Link>
  );
}

// ── Server helpers ───────────────────────────────────────────────────

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
const DEFAULT_PAGE_SIZE: PageSize = 10;

/** Parse a `?page=` value to a 1-indexed integer with a safe default. */
export function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Parse a `?pageSize=` value, snapping to the allowed options. Junk or
 *  out-of-range values fall back to the default — defends against
 *  someone hand-editing the URL with `pageSize=1000000`. */
export function parsePageSize(raw: string | undefined): PageSize {
  const n = Number.parseInt(raw ?? "", 10);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n)
    ? (n as PageSize)
    : DEFAULT_PAGE_SIZE;
}

/** Compute SQL LIMIT/OFFSET for a 1-indexed page. */
export function pageWindow(
  page: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
): { limit: number; offset: number } {
  return {
    // +1 lets us detect "has more" without a separate COUNT(*) query.
    limit: pageSize + 1,
    offset: Math.max(0, (page - 1) * pageSize),
  };
}

/** Slice a `LIMIT pageSize + 1` result and return whether more exist. */
export function takePage<T>(
  rows: T[],
  pageSize: number = DEFAULT_PAGE_SIZE,
): { items: T[]; hasMore: boolean } {
  if (rows.length > pageSize) {
    return { items: rows.slice(0, pageSize), hasMore: true };
  }
  return { items: rows, hasMore: false };
}

export const PAGE_SIZE = DEFAULT_PAGE_SIZE;

// ── Fixed-height grid helper ─────────────────────────────────────────
//
// Reserves a stable min-height for a list table so paging from a full page to
// a short last page (or an empty filter result) doesn't visibly shrink the
// card. We reserve room for `min(pageSize, totalItems)` rows: a fully-populated
// result reserves exactly one page (every page is the same height → no shift),
// while a result smaller than one page reserves only what it holds (no giant
// empty void). `rowPx` is intentionally generous so a full page's real height
// never exceeds the reservation (which would reintroduce the shift).

const TABLE_HEADER_PX = 41;
const DEFAULT_ROW_PX = 53;

export function reservedTableHeight(
  pageSize: number,
  totalItems: number,
  rowPx: number = DEFAULT_ROW_PX,
): number {
  const rows = Math.min(pageSize, Math.max(0, totalItems));
  if (rows === 0) return 0;
  return rows * rowPx + TABLE_HEADER_PX;
}
