import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  StickyActionsCell,
  StickyActionsHead,
} from "@/components/ui/row-actions";
import {
  Pagination,
  parsePage,
  parsePageSize,
} from "@/components/ui/pagination";
import { RoleRowActions } from "@/components/roles/role-row-actions";
import { listRolesForAdmin } from "@/app/actions/roles";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";

type SearchParams = Promise<{ page?: string; pageSize?: string }>;

export default async function RolesListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (!(await can(user, "roles.view", { type: "global" }, productionContext))) {
    redirect("/admin");
  }

  const sp = await searchParams;
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.pageSize);

  const [allRows, canCreate, canEdit, canDelete] = await Promise.all([
    listRolesForAdmin(),
    can(user, "roles.create", { type: "global" }, productionContext),
    can(user, "roles.update", { type: "global" }, productionContext),
    can(user, "roles.delete", { type: "global" }, productionContext),
  ]);
  const t = await getTranslations("roles.list");
  const tCommon = await getTranslations("common");

  // listRolesForAdmin returns the full set (small list — typically <20).
  // Paginate at the page level for visual consistency with other tables.
  const offset = (page - 1) * pageSize;
  const rows = allRows.slice(offset, offset + pageSize);
  const hasMore = allRows.length > offset + pageSize;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">{t("title")}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("subtitle")} · {t("count", { count: rows.length })}
          </p>
        </div>
        {canCreate ? (
          <Button nativeButton={false} render={<Link href="/admin/roles/new" />}>
            {t("createButton")}
          </Button>
        ) : null}
      </div>

      <Card className="p-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">{t("columns.name")}</TableHead>
                <TableHead>{t("columns.type")}</TableHead>
                <TableHead>{t("columns.users")}</TableHead>
                <TableHead>{t("columns.description")}</TableHead>
                <StickyActionsHead>{tCommon("actions")}</StickyActionsHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="px-4">
                    <Link
                      href={`/admin/roles/${r.id}`}
                      className="text-blue-600 hover:underline dark:text-blue-400 font-medium"
                    >
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.isSystem ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border bg-zinc-100 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                        {t("system")}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs text-zinc-500 dark:text-zinc-400">
                    {t("userCount", { count: r.userCount })}
                  </TableCell>
                  <TableCell className="text-xs text-zinc-500 dark:text-zinc-400">
                    {r.description ?? ""}
                  </TableCell>
                  <StickyActionsCell>
                    <RoleRowActions
                      role={r}
                      canEdit={canEdit}
                      canDelete={canDelete}
                    />
                  </StickyActionsCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Pagination
        pathname="/admin/roles"
        page={page}
        pageSize={pageSize}
        hasMore={hasMore}
        searchParams={new URLSearchParams(
          Object.entries(sp).filter(
            ([, v]) => typeof v === "string" && v.length > 0,
          ) as [string, string][],
        )}
        labels={{
          previous: tCommon("pagination.previous"),
          next: tCommon("pagination.next"),
          page: tCommon("pagination.page", { page }),
          rowsPerPage: tCommon("pagination.rowsPerPage"),
        }}
      />
    </div>
  );
}
