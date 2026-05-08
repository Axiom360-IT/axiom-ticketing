"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  type AuditCursor,
  type AuditEntryRow,
  type AuditFilters,
  listAuditEntries,
} from "@/app/actions/audit";
import { AuditDetailsButton } from "./details-modal";

type Props = {
  initialCursor: AuditCursor | null;
  filters: AuditFilters;
};

/**
 * Renders a Load-more button that appends rows to the table on click.
 * Sits in its own component so the rest of the audit page stays a server
 * component and we don't have to round-trip filter state through search
 * params on every cursor click.
 */
export function AuditLoadMore({ initialCursor, filters }: Props) {
  const t = useTranslations("audit");
  const formatter = useFormatter();
  const [appended, setAppended] = useState<AuditEntryRow[]>([]);
  const [cursor, setCursor] = useState<AuditCursor | null>(initialCursor);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!cursor) return;
    setError(null);
    startTransition(async () => {
      try {
        const next = await listAuditEntries({ filters, cursor });
        setAppended((prev) => [
          ...prev,
          ...next.rows.map((r) => ({ ...r, timestamp: new Date(r.timestamp) })),
        ]);
        setCursor(next.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      }
    });
  }

  return (
    <>
      {appended.map((row) => (
        <tr
          key={row.id}
          className="border-t border-zinc-100 dark:border-zinc-800"
        >
          <td className="py-2 pr-4 font-mono text-xs">
            {formatter.dateTime(row.timestamp, {
              dateStyle: "short",
              timeStyle: "medium",
            })}
          </td>
          <td className="py-2 pr-4 text-xs">
            {row.actorName ? (
              <span title={row.actorEmail ?? ""}>{row.actorName}</span>
            ) : (
              <span className="text-zinc-400">—</span>
            )}
          </td>
          <td className="py-2 pr-4 font-mono text-xs">{row.action}</td>
          <td className="py-2 pr-4 text-xs">
            {row.targetType ? (
              <span>
                {row.targetType}
                {row.targetId ? (
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {" · "}
                    <code className="font-mono">{row.targetId}</code>
                  </span>
                ) : null}
              </span>
            ) : null}
          </td>
          <td className="py-2 pr-4 text-xs text-zinc-500 dark:text-zinc-400">
            {row.ipAddress ?? ""}
          </td>
          <td className="py-2">
            <AuditDetailsButton entryId={row.id} />
          </td>
        </tr>
      ))}
      {cursor ? (
        <tr>
          <td colSpan={6} className="py-3 text-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={handleClick}
            >
              {isPending ? t("loadingMore") : t("loadMore")}
            </Button>
            {error ? (
              <p className="text-xs text-red-600 mt-1">{error}</p>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}
