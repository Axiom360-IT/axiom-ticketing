import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import {
  Activity,
  ArrowRight,
  Receipt,
  Settings as SettingsIcon,
  ShieldAlert,
  Ticket,
  Users as UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExportMenu } from "@/components/shared/export-menu";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Pagination,
  pageWindow,
  parsePage,
  parsePageSize,
  reservedTableHeight,
  takePage,
} from "@/components/ui/pagination";
import { AuditDetailsButton } from "@/components/audit/details-modal";
import {
  listAuditActions,
  listAuditActors,
  listAuditEntriesOffset,
  type AuditFilters,
} from "@/app/actions/audit";
import {
  auditActionCategory,
  auditActionLabel,
  auditOutcomeLabel,
  AUDIT_CATEGORY_LABEL,
  AUDIT_CATEGORY_ORDER,
  type AuditCategory,
  friendlyAuditTarget,
  humanizeFieldKey,
  isDestructiveAction,
} from "@/lib/audit/action-label";
import { computeChanges, type FieldChange } from "@/lib/audit/diff";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

type SearchParams = Promise<{
  from?: string;
  to?: string;
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  page?: string;
  pageSize?: string;
}>;

// Date-only strings are promoted to a UTC instant. `to` snaps to END-of-day so
// a `to=2026-07-16` filter includes all of the 16th (previously it collapsed to
// midnight and excluded nearly the whole day).
function toIso(v: string | undefined, endOfDay = false): string | undefined {
  if (!v) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
    return new Date(`${v}T${time}Z`).toISOString();
  }
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
}

// Category → icon + colour. The coloured rail/icon is the peripheral scan
// channel so a security event never looks like a routine ticket edit.
const CATEGORY_META: Record<
  AuditCategory,
  { icon: LucideIcon; badge: string }
> = {
  tickets: {
    icon: Ticket,
    badge:
      "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400",
  },
  users: {
    icon: UsersIcon,
    badge:
      "bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-400",
  },
  security: {
    icon: ShieldAlert,
    badge: "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400",
  },
  billing: {
    icon: Receipt,
    badge:
      "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400",
  },
  config: {
    icon: SettingsIcon,
    badge:
      "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400",
  },
  system: {
    icon: Activity,
    badge: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  },
};

// Non-success outcomes get a loud badge — a denied/failed privileged attempt
// must never look like a routine success. (Labels come from auditOutcomeLabel.)
function outcomeStyle(outcome: string): string {
  return outcome === "denied"
    ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
    : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
}

function chipValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > 24 ? `${v.slice(0, 21)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "…";
}

function relativeTime(then: Date, now: number): string {
  const mins = Math.floor((now - then.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (
    !(await can(user, "audit.view", { type: "global" }, productionContext))
  ) {
    redirect("/admin");
  }

  const sp = await searchParams;
  const filters: AuditFilters = {
    from: toIso(sp.from),
    to: toIso(sp.to, true),
    actorId: sp.actorId || undefined,
    action: sp.action || undefined,
    targetType: sp.targetType || undefined,
    targetId: sp.targetId || undefined,
  };

  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.pageSize);
  const { limit, offset } = pageWindow(page, pageSize);

  const [pageData, actions, actors, canExport] = await Promise.all([
    listAuditEntriesOffset({ filters, limit, offset }),
    listAuditActions(),
    listAuditActors(),
    can(user, "audit.export", { type: "global" }, productionContext),
  ]);
  const { items: rows } = takePage(pageData.rows, pageSize);
  const totalItems = pageData.total;

  const t = await getTranslations("audit");
  const formatter = await getFormatter();
  const now = Date.now();

  // Group the action filter by category so the dropdown is navigable.
  const actionsByCategory = new Map<AuditCategory, string[]>();
  for (const a of actions) {
    const c = auditActionCategory(a);
    const bucket = actionsByCategory.get(c) ?? [];
    bucket.push(a);
    actionsByCategory.set(c, bucket);
  }

  // Preserve current params (minus paging) on the pager + export links.
  const carried = Object.entries(sp).filter(
    ([k, v]) => typeof v === "string" && v.length > 0 && k !== "page",
  ) as [string, string][];
  const exportParams: Record<string, string> = Object.fromEntries(
    carried.filter(([k]) => k !== "pageSize"),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">{t("page.title")}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("page.subtitle")}
          </p>
        </div>
        {canExport ? (
          <ExportMenu baseHref="/api/audit/export" params={exportParams} />
        ) : null}
      </div>

      <form
        action="/admin/audit"
        method="get"
        className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3 items-end"
      >
        <div className="space-y-1">
          <Label htmlFor="audit-from">{t("filters.from")}</Label>
          <Input id="audit-from" name="from" type="date" defaultValue={sp.from ?? ""} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-to">{t("filters.to")}</Label>
          <Input id="audit-to" name="to" type="date" defaultValue={sp.to ?? ""} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-actor">{t("filters.actor")}</Label>
          <select
            id="audit-actor"
            name="actorId"
            defaultValue={sp.actorId ?? ""}
            className="h-8 w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 text-sm"
          >
            <option value="">{t("filters.actorAll")}</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-action">{t("filters.action")}</Label>
          <select
            id="audit-action"
            name="action"
            defaultValue={sp.action ?? ""}
            className="h-8 w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 text-sm"
          >
            <option value="">{t("filters.actionAll")}</option>
            {AUDIT_CATEGORY_ORDER.filter((c) => actionsByCategory.has(c)).map(
              (c) => (
                <optgroup key={c} label={AUDIT_CATEGORY_LABEL[c]}>
                  {(actionsByCategory.get(c) ?? []).map((a) => (
                    <option key={a} value={a}>
                      {auditActionLabel(a)}
                    </option>
                  ))}
                </optgroup>
              ),
            )}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-targetType">{t("filters.targetType")}</Label>
          <Input id="audit-targetType" name="targetType" defaultValue={sp.targetType ?? ""} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-targetId">{t("filters.targetId")}</Label>
          <Input id="audit-targetId" name="targetId" defaultValue={sp.targetId ?? ""} />
        </div>
        <div className="md:col-span-3 lg:col-span-6 flex gap-2">
          <Button type="submit">{t("filters.apply")}</Button>
          <Button nativeButton={false} render={<Link href="/admin/audit" />} variant="outline">
            {t("filters.reset")}
          </Button>
        </div>
      </form>

      <Card className="p-0">
        <CardContent
          className="p-0"
          style={{ minHeight: reservedTableHeight(pageSize, totalItems, 60) }}
        >
          {rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {t("empty")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
                    <th className="px-4 py-2">{t("columns.event")}</th>
                    <th className="py-2 pr-4">{t("columns.category")}</th>
                    <th className="py-2 pr-4">{t("columns.target")}</th>
                    <th className="py-2 pr-4">{t("columns.outcome")}</th>
                    <th className="py-2 pr-4">{t("columns.actor")}</th>
                    <th className="py-2 pr-4">{t("columns.when")}</th>
                    <th className="py-2 pr-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const category = auditActionCategory(row.action);
                    const destructive = isDestructiveAction(row.action);
                    const meta = CATEGORY_META[category];
                    const Icon = meta.icon;
                    const changes: FieldChange[] = computeChanges(
                      row.beforeValue,
                      row.afterValue,
                    );
                    const target = friendlyAuditTarget(row);
                    return (
                      <tr
                        key={row.id}
                        className="border-t border-zinc-100 align-top dark:border-zinc-800"
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-start gap-2.5">
                            <span
                              className={cn(
                                "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md",
                                destructive
                                  ? "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400"
                                  : meta.badge,
                              )}
                            >
                              <Icon className="size-3.5" aria-hidden="true" />
                            </span>
                            <div className="min-w-0">
                              <div className="text-zinc-800 dark:text-zinc-200">
                                <span className="font-medium" title={row.action}>
                                  {auditActionLabel(row.action)}
                                </span>
                              </div>
                              {changes.length > 0 ? (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {changes.slice(0, 3).map((c) => (
                                    <span
                                      key={c.field}
                                      className="inline-flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                                    >
                                      <span className="text-zinc-400 dark:text-zinc-500">
                                        {humanizeFieldKey(c.field)}
                                      </span>
                                      {c.kind === "changed" ? (
                                        <>
                                          {chipValue(c.from)}
                                          <ArrowRight
                                            className="size-3 text-zinc-400"
                                            aria-hidden="true"
                                          />
                                          <span className="font-medium">
                                            {chipValue(c.to)}
                                          </span>
                                        </>
                                      ) : c.kind === "added" ? (
                                        <span className="font-medium">
                                          {chipValue(c.to)}
                                        </span>
                                      ) : (
                                        <span className="line-through">
                                          {chipValue(c.from)}
                                        </span>
                                      )}
                                    </span>
                                  ))}
                                  {changes.length > 3 ? (
                                    <span className="text-[11px] text-zinc-400">
                                      +{changes.length - 3}
                                    </span>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 pr-4">
                          <span
                            className={cn(
                              "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
                              meta.badge,
                            )}
                          >
                            {AUDIT_CATEGORY_LABEL[category]}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4">
                          <span
                            className={cn(
                              "text-xs",
                              target === "—"
                                ? "text-zinc-400"
                                : "text-zinc-600 dark:text-zinc-300",
                            )}
                            title={target}
                          >
                            {target.length > 28
                              ? `${target.slice(0, 25)}…`
                              : target}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4">
                          {row.outcome === "success" ? (
                            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-emerald-600 dark:text-emerald-400">
                              <span
                                aria-hidden="true"
                                className="size-1.5 rounded-full bg-emerald-500"
                              />
                              {auditOutcomeLabel(row.outcome)}
                            </span>
                          ) : (
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap",
                                outcomeStyle(row.outcome),
                              )}
                            >
                              {auditOutcomeLabel(row.outcome)}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4">
                          {row.actorName ? (
                            <>
                              <div
                                className="text-xs text-zinc-700 dark:text-zinc-300"
                                title={row.actorEmail ?? ""}
                              >
                                {row.actorName}
                              </div>
                              {row.actorRoleSnapshot ? (
                                <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
                                  {row.actorRoleSnapshot}
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-xs text-zinc-400">
                              {t("systemActor")}
                            </span>
                          )}
                        </td>
                        <td
                          className="py-2.5 pr-4 text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400"
                          title={formatter.dateTime(row.timestamp, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        >
                          {relativeTime(row.timestamp, now)}
                        </td>
                        <td className="py-2.5 pr-4">
                          <AuditDetailsButton entryId={row.id} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Pagination
        pathname="/admin/audit"
        page={page}
        pageSize={pageSize}
        totalItems={totalItems}
        searchParams={new URLSearchParams(carried)}
      />
    </div>
  );
}
