"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { reservedTableHeight } from "@/components/ui/pagination";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { cn } from "@/lib/utils";

// Generic, URL-driven data grid. Rendering, sorting, and filtering are all
// server-side (TanStack runs in "manual" mode) — the header menus write sort +
// filter state into the URL, the server re-queries, and this just renders the
// current page. Pairs with the numbered `<Pagination>` bar below it.

// Right-pinned actions column (matches StickyActions* in row-actions.tsx).
const STICKY_CLASS =
  "sticky right-0 z-10 bg-card pr-4 text-right shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.08)] dark:shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.4)]";

type DataTableProps<T> = {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  /** Total rows across all pages — drives the fixed grid height. */
  totalItems: number;
  pageSize: number;
  /** Approx row height (px) for the reserved min-height; tune per grid. */
  rowPx?: number;
  emptyMessage: string;
};

export function DataTable<T>({
  columns,
  data,
  totalItems,
  pageSize,
  rowPx,
  emptyMessage,
}: DataTableProps<T>) {
  // TanStack Table manages its own memoization internally; React Compiler skips
  // memoizing this component as a result — expected and safe.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
  });

  return (
    <Card className="p-0">
      <CardContent
        className="p-0"
        style={{ minHeight: reservedTableHeight(pageSize, totalItems, rowPx) }}
      >
        {/* The column headers always render — even with no rows — so the grid
            structure stays visible and the empty state reads as "0 results in
            this table", not "no table". */}
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  return (
                    <TableHead
                      key={header.id}
                      scope="col"
                      className={cn(
                        meta?.headClassName,
                        meta?.sticky && STICKY_CLASS,
                      )}
                    >
                      {header.isPlaceholder ? null : (
                        <DataTableColumnHeader column={header.column} />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {data.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={table.getVisibleLeafColumns().length}
                  className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta;
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          meta?.cellClassName,
                          meta?.sticky && STICKY_CLASS,
                        )}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
