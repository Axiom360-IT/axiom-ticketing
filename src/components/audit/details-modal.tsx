"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { type AuditEntryDetail, getAuditEntry } from "@/app/actions/audit";
import { auditActionLabel, humanizeFieldKey } from "@/lib/audit/action-label";
import { computeChanges, type FieldChange } from "@/lib/audit/diff";
import { cn } from "@/lib/utils";

type Props = {
  entryId: string;
};

const OUTCOME_LABEL: Record<string, string> = {
  denied: "Denied",
  failure: "Failed",
  error: "Error",
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

  const changes: FieldChange[] = detail
    ? computeChanges(detail.beforeValue, detail.afterValue)
    : [];
  const target =
    detail?.targetLabel ?? detail?.targetId ?? detail?.targetType ?? null;

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
          <div className="space-y-4 text-sm">
            {/* Plain-language summary */}
            <div className="space-y-0.5">
              <p className="font-medium text-zinc-900 dark:text-zinc-50">
                {auditActionLabel(detail.action)}
                {target ? (
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {" · "}
                    <span className="font-mono text-xs">{target}</span>
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {detail.actorName
                  ? t("details.byActor", {
                      actor: detail.actorEmail
                        ? `${detail.actorName} (${detail.actorEmail})`
                        : detail.actorName,
                    })
                  : t("systemActor")}
                {" · "}
                {formatter.dateTime(detail.timestamp, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
              {detail.impersonatorId ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {t("details.viaImpersonator", {
                    actor:
                      detail.impersonatorName ??
                      detail.impersonatorEmail ??
                      detail.impersonatorId,
                  })}
                </p>
              ) : null}
              {detail.outcome !== "success" ? (
                <p className="text-xs font-medium text-red-600 dark:text-red-400">
                  {OUTCOME_LABEL[detail.outcome] ?? detail.outcome}
                  {detail.failureReason ? `: ${detail.failureReason}` : ""}
                </p>
              ) : null}
            </div>

            {/* Field-level diff */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                {t("details.changesLabel")}
              </p>
              {changes.length === 0 ? (
                <p className="text-xs text-zinc-400">
                  {t("details.noChanges")}
                </p>
              ) : (
                <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-zinc-50 text-left text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                        <th className="px-2.5 py-1.5 font-medium">
                          {t("details.fieldCol")}
                        </th>
                        <th className="px-2.5 py-1.5 font-medium">
                          {t("details.beforeCol")}
                        </th>
                        <th className="px-2.5 py-1.5 font-medium">
                          {t("details.afterCol")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {changes.map((c) => (
                        <tr
                          key={c.field}
                          className="border-t border-zinc-100 align-top dark:border-zinc-800"
                        >
                          <td className="px-2.5 py-1.5 text-zinc-500 dark:text-zinc-400">
                            {humanizeFieldKey(c.field)}
                          </td>
                          <td className="px-2.5 py-1.5">
                            {c.kind === "added" ? (
                              <span className="text-zinc-300 dark:text-zinc-600">
                                —
                              </span>
                            ) : (
                              <Value
                                v={c.from}
                                userNames={detail.userNames}
                                tone="removed"
                              />
                            )}
                          </td>
                          <td className="px-2.5 py-1.5">
                            {c.kind === "removed" ? (
                              <span className="text-zinc-300 dark:text-zinc-600">
                                —
                              </span>
                            ) : (
                              <Value
                                v={c.to}
                                userNames={detail.userNames}
                                tone="added"
                              />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Technical details — hidden by default so the common case stays clean */}
            <details className="rounded-md border border-zinc-200 dark:border-zinc-800">
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                {t("details.technical")}
              </summary>
              <div className="space-y-1.5 border-t border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
                <TechRow
                  label={t("columns.target")}
                  value={
                    detail.targetType || detail.targetId
                      ? `${detail.targetType ?? ""}${
                          detail.targetId ? ` · ${detail.targetId}` : ""
                        }`
                      : null
                  }
                />
                <TechRow
                  label={t("details.roleSnapshotLabel")}
                  value={detail.actorRoleSnapshot}
                />
                <TechRow label={t("details.ipLabel")} value={detail.ipAddress} mono />
                <TechRow
                  label={t("details.userAgentLabel")}
                  value={detail.userAgent}
                />
                <TechRow
                  label={t("details.requestIdLabel")}
                  value={detail.requestId}
                  mono
                />
                {(detail.beforeValue != null || detail.afterValue != null) && (
                  <div className="pt-1">
                    <p className="mb-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                      {t("details.rawLabel")}
                    </p>
                    <pre className="max-h-56 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-2 font-mono text-[11px] whitespace-pre-wrap dark:border-zinc-800 dark:bg-zinc-900">
                      {JSON.stringify(
                        {
                          before: detail.beforeValue ?? null,
                          after: detail.afterValue ?? null,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                )}
              </div>
            </details>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

/** A field value, resolving user-id UUIDs to names and tinting add/remove. */
function Value({
  v,
  userNames,
  tone,
}: {
  v: unknown;
  userNames: Record<string, string>;
  tone: "added" | "removed";
}) {
  const resolved =
    typeof v === "string" && userNames[v] ? (
      <span title={v}>{userNames[v]}</span>
    ) : (
      formatValue(v)
    );
  return (
    <span
      className={cn(
        "break-words whitespace-pre-wrap",
        tone === "added"
          ? "text-emerald-700 dark:text-emerald-400"
          : "text-red-700 line-through decoration-red-300 dark:text-red-400",
      )}
    >
      {resolved}
    </span>
  );
}

function TechRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex gap-3">
      <span className="w-28 shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 break-all text-xs text-zinc-700 dark:text-zinc-300",
          mono && "font-mono",
        )}
      >
        {value}
      </span>
    </div>
  );
}
