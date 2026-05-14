import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageSizeSelect } from "./page-size-select";

// URL-driven pagination. Server-rendered (just Links — no client JS),
// preserves every other search param so a paginated link still carries
// the active filters / search query.
//
// Sizing strategy used by callers: `LIMIT pageSize + 1` then `hasMore =
// rows.length > pageSize`, slice the array to `pageSize`. Cheaper than
// a separate `SELECT COUNT(*)` query when total count isn't displayed.

const PAGE_PARAM = "page";

type Props = {
  /** Path the link points back to (e.g. "/admin/tickets"). */
  pathname: string;
  /** Current `?page=` value (1-indexed). */
  page: number;
  /** Current `?pageSize=` value (rows per page). */
  pageSize: number;
  /** Did the server SELECT one extra row beyond pageSize? */
  hasMore: boolean;
  /** All other current search params — preserved on prev/next links. */
  searchParams: ReadonlyURLSearchParams;
  /** Visible label texts. Defaults are English; pass translated.
   *  `page` is rendered as-is — caller is responsible for substituting
   *  the current page number (next-intl validates substitution
   *  variables at the `t()` call site, not in this component). */
  labels?: {
    previous?: string;
    next?: string;
    page?: string;
    rowsPerPage?: string;
  };
  /** Hide the entire bar when there's only one page total. Default
   *  `false` — the bar always renders so users see the affordance even
   *  on a single-page list (the prev/next buttons are disabled). */
  hideWhenSinglePage?: boolean;
  className?: string;
};

// Lightweight subset of `URLSearchParams` so the component can be
// rendered server-side without importing `next/navigation`'s client
// hook. Callers pass `new URLSearchParams(...)` made from awaited
// searchParams.
type ReadonlyURLSearchParams = Pick<URLSearchParams, "toString" | "set" | "delete" | "get">;

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

export function Pagination({
  pathname,
  page,
  pageSize,
  hasMore,
  searchParams,
  labels,
  hideWhenSinglePage = false,
  className,
}: Props) {
  const isFirstPage = page <= 1;
  if (hideWhenSinglePage && isFirstPage && !hasMore) return null;

  const prevHref = buildHref(pathname, searchParams, page - 1);
  const nextHref = buildHref(pathname, searchParams, page + 1);

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 text-sm",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <PageSizeSelect
          currentSize={pageSize}
          label={labels?.rowsPerPage ?? "Rows per page"}
        />
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {labels?.page ?? `Page ${page}`}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <PageLink
          href={prevHref}
          disabled={isFirstPage}
          aria-label={labels?.previous ?? "Previous page"}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">
            {labels?.previous ?? "Previous"}
          </span>
        </PageLink>
        <PageLink
          href={nextHref}
          disabled={!hasMore}
          aria-label={labels?.next ?? "Next page"}
        >
          <span className="hidden sm:inline">{labels?.next ?? "Next"}</span>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </PageLink>
      </div>
    </nav>
  );
}

function PageLink({
  href,
  disabled,
  children,
  ...props
}: {
  href: string;
  disabled?: boolean;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  const className =
    "inline-flex items-center gap-1 px-3 py-2 min-h-[36px] rounded-md border border-zinc-200 dark:border-zinc-800 text-sm transition-colors";
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className={cn(
          className,
          "text-zinc-400 dark:text-zinc-600 cursor-not-allowed bg-zinc-50 dark:bg-zinc-900",
        )}
        {...props}
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={cn(
        className,
        "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-zinc-50",
      )}
      {...props}
    >
      {children}
    </Link>
  );
}

// ── Server helpers ───────────────────────────────────────────────────

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
const DEFAULT_PAGE_SIZE: PageSize = 25;

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
