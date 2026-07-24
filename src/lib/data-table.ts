// Shared, server-safe helpers for the URL-driven data grid. The grids are
// server-paginated, so sorting is expressed as a `?sort=<id>:<dir>` URL param
// that the page reads to build its ORDER BY. Keep this module free of client
// imports so server components can use it.

export type SortDir = "asc" | "desc";
export type SortState = { id: string; dir: SortDir };

/**
 * Parse a `?sort=<id>:<dir>` value into a SortState, restricted to an allow-list
 * of sortable column ids (defends against a hand-edited URL selecting a column
 * that doesn't map to a real ORDER BY). Returns null for missing/invalid input
 * so the caller applies its own default ordering.
 */
export function parseSort(
  raw: string | undefined,
  allowed: readonly string[],
): SortState | null {
  if (!raw) return null;
  const idx = raw.lastIndexOf(":");
  if (idx <= 0) return null;
  const id = raw.slice(0, idx);
  const dir = raw.slice(idx + 1);
  if (!allowed.includes(id)) return null;
  return { id, dir: dir === "asc" ? "asc" : "desc" };
}

/** Build a `?sort=` value from an id + direction. */
export function buildSortValue(id: string, dir: SortDir): string {
  return `${id}:${dir}`;
}

/**
 * Split a multi-select column-filter CSV value (e.g. `org=id1,id2`) into a
 * trimmed, empty-free string array. Returns `[]` for missing/blank input.
 */
export function parseCsv(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * In-memory sort for grids that materialise their full (filtered) list in JS
 * before paginating (users/roles/organizations). `accessors` maps a sort id to
 * a value extractor; numbers compare numerically, everything else by locale
 * string. Nulls always sort last regardless of direction. Returns the input
 * unchanged when there's no sort or no matching accessor.
 */
export function sortRows<T>(
  rows: T[],
  sort: SortState | null,
  accessors: Record<string, (row: T) => string | number | null | undefined>,
): T[] {
  if (!sort) return rows;
  const accessor = accessors[sort.id];
  if (!accessor) return rows;
  const factor = sort.dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
    return cmp * factor;
  });
}
