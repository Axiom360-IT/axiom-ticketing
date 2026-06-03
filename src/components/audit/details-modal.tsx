"use client";

import { Fragment, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  type AuditEntryDetail,
  getAuditEntry,
} from "@/app/actions/audit";
import { auditActionLabel, humanizeFieldKey } from "@/lib/audit/action-label";

type Props = {
  entryId: string;
};

export function AuditDetailsButton({ entryId }: Props) {
  const t = useTranslations("audit");
  const formatter = useFormatter();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<AuditEntryDetail | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && !detail) {
      startTransition(async () => {
        const d = await getAuditEntry(entryId);
        if (d) setDetail(d);
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="xs">
            {t("viewDetails")}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("details.title")}</DialogTitle>
        </DialogHeader>
        {isPending || !detail ? (
          <div className="py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
            …
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <Row
              label={t("columns.timestamp")}
              value={formatter.dateTime(detail.timestamp, {
                dateStyle: "medium",
                timeStyle: "long",
              })}
            />
            <Row
              label={t("columns.action")}
              value={
                <span title={detail.action}>
                  {auditActionLabel(detail.action)}
                </span>
              }
            />
            <Row
              label={t("details.actorLabel")}
              value={
                detail.actorName
                  ? `${detail.actorName} (${detail.actorEmail ?? "—"})`
                  : "—"
              }
            />
            {detail.impersonatorId ? (
              <Row
                label={t("details.impersonatorLabel")}
                value={
                  detail.impersonatorName
                    ? `${detail.impersonatorName} (${detail.impersonatorEmail ?? "—"})`
                    : detail.impersonatorId
                }
              />
            ) : null}
            {detail.actorRoleSnapshot ? (
              <Row
                label={t("details.roleSnapshotLabel")}
                value={detail.actorRoleSnapshot}
              />
            ) : null}
            {detail.targetType || detail.targetId ? (
              <Row
                label={t("columns.target")}
                value={
                  <span>
                    {detail.targetType ?? ""}
                    {detail.targetId ? ` · ${detail.targetId}` : ""}
                  </span>
                }
              />
            ) : null}
            {detail.ipAddress ? (
              <Row
                label={t("details.ipLabel")}
                value={<code className="font-mono text-xs">{detail.ipAddress}</code>}
              />
            ) : null}
            {detail.requestId ? (
              <Row
                label={t("details.requestIdLabel")}
                value={<code className="font-mono text-xs">{detail.requestId}</code>}
              />
            ) : null}
            <FieldsBlock
              label={t("details.beforeLabel")}
              empty={t("details.noBefore")}
              value={detail.beforeValue}
            />
            <FieldsBlock
              label={t("details.afterLabel")}
              empty={t("details.noAfter")}
              value={detail.afterValue}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="text-zinc-500 dark:text-zinc-400 w-40 shrink-0 text-xs">
        {label}
      </span>
      <span className="flex-1 break-all">{value}</span>
    </div>
  );
}

function formatFieldValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

/** Render a before/after snapshot as readable "Field: value" rows (instead of
 *  raw JSON). Falls back to JSON for arrays/nested non-object values. */
function FieldsBlock({
  label,
  empty,
  value,
}: {
  label: string;
  empty: string;
  value: unknown;
}) {
  const isEmpty =
    value === null ||
    value === undefined ||
    (typeof value === "object" && Object.keys(value as object).length === 0);
  const isPlainObject =
    typeof value === "object" && value !== null && !Array.isArray(value);
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
        {label}
      </p>
      {isEmpty ? (
        <p className="text-xs text-zinc-400">{empty}</p>
      ) : isPlainObject ? (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 rounded-md border border-zinc-200 dark:border-zinc-800 p-2 text-xs">
          {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
            <Fragment key={k}>
              <dt className="text-zinc-500 dark:text-zinc-400">
                {humanizeFieldKey(k)}
              </dt>
              <dd className="break-words whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
                {formatFieldValue(v)}
              </dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        <pre className="text-xs font-mono bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md p-2 overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}
