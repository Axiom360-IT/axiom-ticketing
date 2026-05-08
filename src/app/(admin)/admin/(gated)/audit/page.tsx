import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuditDetailsButton } from "@/components/audit/details-modal";
import { AuditLoadMore } from "@/components/audit/load-more";
import {
  listAuditActions,
  listAuditActors,
  listAuditEntries,
  type AuditFilters,
} from "@/app/actions/audit";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  from?: string;
  to?: string;
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
}>;

function isoOrUndefined(v: string | undefined): string | undefined {
  if (!v) return undefined;
  // Accept date-only strings (YYYY-MM-DD) by promoting to UTC midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return new Date(`${v}T00:00:00.000Z`).toISOString();
  }
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
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
    from: isoOrUndefined(sp.from),
    to: isoOrUndefined(sp.to),
    actorId: sp.actorId || undefined,
    action: sp.action || undefined,
    targetType: sp.targetType || undefined,
    targetId: sp.targetId || undefined,
  };

  const [page, actions, actors, canExport] = await Promise.all([
    listAuditEntries({ filters }),
    listAuditActions(),
    listAuditActors(),
    can(user, "audit.export", { type: "global" }, productionContext),
  ]);

  const t = await getTranslations("audit");
  const formatter = await getFormatter();

  // Build the export URL preserving current filters.
  const exportParams = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (typeof v === "string" && v.length > 0) exportParams.set(k, v);
  }
  const exportUrl = `/api/audit/export?${exportParams.toString()}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("page.subtitle")}
          </p>
        </div>
        {canExport ? (
          <Button render={<Link href={exportUrl} prefetch={false} />}>
            {t("page.exportCsv")}
          </Button>
        ) : null}
      </div>

      <form
        action="/admin/audit"
        method="get"
        className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3 items-end"
      >
        <div className="space-y-1">
          <Label htmlFor="audit-from">{t("filters.from")}</Label>
          <Input
            id="audit-from"
            name="from"
            type="date"
            defaultValue={sp.from ?? ""}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-to">{t("filters.to")}</Label>
          <Input
            id="audit-to"
            name="to"
            type="date"
            defaultValue={sp.to ?? ""}
          />
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
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-targetType">{t("filters.targetType")}</Label>
          <Input
            id="audit-targetType"
            name="targetType"
            defaultValue={sp.targetType ?? ""}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-targetId">{t("filters.targetId")}</Label>
          <Input
            id="audit-targetId"
            name="targetId"
            defaultValue={sp.targetId ?? ""}
          />
        </div>
        <div className="md:col-span-3 lg:col-span-6 flex gap-2">
          <Button type="submit">{t("filters.apply")}</Button>
          <Button render={<Link href="/admin/audit" />} variant="outline">
            {t("filters.reset")}
          </Button>
        </div>
      </form>

      <Card className="p-0">
        <CardContent className="p-0">
          {page.rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {t("empty")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
                    <th className="px-4 py-2">{t("columns.timestamp")}</th>
                    <th className="py-2 pr-4">{t("columns.actor")}</th>
                    <th className="py-2 pr-4">{t("columns.action")}</th>
                    <th className="py-2 pr-4">{t("columns.target")}</th>
                    <th className="py-2 pr-4">{t("columns.ipAddress")}</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {page.rows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-t border-zinc-100 dark:border-zinc-800"
                    >
                      <td className="px-4 py-2 font-mono text-xs">
                        {formatter.dateTime(row.timestamp, {
                          dateStyle: "short",
                          timeStyle: "medium",
                        })}
                      </td>
                      <td className="py-2 pr-4 text-xs">
                        {row.actorName ? (
                          <span title={row.actorEmail ?? ""}>
                            {row.actorName}
                          </span>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">
                        {row.action}
                      </td>
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
                  <AuditLoadMore
                    initialCursor={page.nextCursor}
                    filters={filters}
                  />
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
