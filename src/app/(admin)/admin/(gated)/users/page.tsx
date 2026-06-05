import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
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
import { UrlFilterSelect } from "@/components/ui/url-filter-select";
import { UrlSearchInput } from "@/components/ui/url-search-input";
import { UserRowActions } from "@/components/users/user-row-actions";
import { listAllRoles, listUsersForAdmin } from "@/app/actions/users";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

type Audience = "internal" | "external";

type SearchParams = Promise<{
  q?: string;
  roleId?: string;
  status?: "active" | "inactive" | "all";
  tab?: Audience;
  page?: string;
  pageSize?: string;
}>;

export default async function UsersListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  if (!(await can(user, "users.view", { type: "global" }, productionContext))) {
    redirect("/admin");
  }

  const t = await getTranslations("users.list");
  const tCommon = await getTranslations("common");
  const formatter = await getFormatter();

  const sp = await searchParams;
  const { q, roleId, status = "active", tab = "internal" } = sp;
  const audience: Audience = tab === "external" ? "external" : "internal";
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.pageSize);

  // For row-action ICON visibility we use the raw permission grant —
  // the per-target check (descendant hierarchy, last-active-Super-Admin,
  // self-action) runs server-side when the user clicks. Showing the
  // icon for users you ultimately can't edit gives a confusing "click
  // → forbidden" — but the alternative is N can() calls per page render
  // (one per row). The dialog shows the actionable error if the action
  // is refused.
  const canEdit = user.permissions.has("users.update");
  const canDeactivate = user.permissions.has("users.deactivate");
  const canReactivate = user.permissions.has("users.reactivate");

  const [allRows, roles, canCreate] = await Promise.all([
    listUsersForAdmin({ query: q, roleId, status, audience }),
    listAllRoles(),
    can(user, "users.create", { type: "global" }, productionContext),
  ]);

  // listUsersForAdmin filters in JS (audience + role + query) — paginate
  // here on the post-filter list. Acceptable at small org scale; if the
  // user table grows beyond a few thousand active rows, push filters
  // into SQL and switch to LIMIT/OFFSET in the helper.
  const offset = (page - 1) * pageSize;
  const rows = allRows.slice(offset, offset + pageSize);
  const hasMore = allRows.length > offset + pageSize;

  function tabHref(target: Audience): string {
    const params = new URLSearchParams();
    params.set("tab", target);
    if (q) params.set("q", q);
    if (roleId) params.set("roleId", roleId);
    if (status !== "active") params.set("status", status);
    return `/admin/users?${params.toString()}`;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">{t("title")}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("count", { count: rows.length })}
          </p>
        </div>
        {canCreate ? (
          <Button nativeButton={false} render={<Link href="/admin/users/new" />}>
            {t("createButton")}
          </Button>
        ) : null}
      </div>

      <nav
        aria-label={t("title")}
        className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800"
      >
        <TabLink
          href={tabHref("internal")}
          active={audience === "internal"}
          label={t("tabInternal")}
        />
        <TabLink
          href={tabHref("external")}
          active={audience === "external"}
          label={t("tabExternal")}
        />
      </nav>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 -mt-2">
        {audience === "internal" ? t("tabHintInternal") : t("tabHintExternal")}
      </p>

      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[14rem]">
          <UrlSearchInput
            initialValue={q ?? ""}
            placeholder={t("search")}
            className="max-w-md"
          />
        </div>

        <UrlFilterSelect
          name="roleId"
          label={t("filterRole")}
          value={roleId ?? ""}
          anyLabel={t("filterRoleAll")}
          options={roles.map((r) => ({ value: r.id, label: r.name }))}
          triggerClassName="w-44"
        />

        <UrlFilterSelect
          name="status"
          label={t("filterStatus")}
          // Empty string is the "default = active" UI sentinel here, but
          // the URL needs explicit values to round-trip. Always pass the
          // current value through; never blank.
          value={status}
          showAny={false}
          options={[
            { value: "active", label: t("filterStatusActive") },
            { value: "inactive", label: t("filterStatusInactive") },
            { value: "all", label: t("filterStatusAll") },
          ]}
          triggerClassName="w-32"
        />
      </div>

      <Card className="p-0">
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {t("empty")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">{t("columns.name")}</TableHead>
                  <TableHead>{t("columns.email")}</TableHead>
                  <TableHead>{t("columns.roles")}</TableHead>
                  <TableHead>{t("columns.status")}</TableHead>
                  <TableHead>{t("columns.createdAt")}</TableHead>
                  <StickyActionsHead>{tCommon("actions")}</StickyActionsHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="px-4">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/admin/users/${u.id}`}
                          className="text-blue-600 hover:underline dark:text-blue-400 font-medium"
                        >
                          {u.name}
                        </Link>
                        {u.id === user.id ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900">
                            {t("selfBadge")}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-zinc-600 dark:text-zinc-300">
                      {u.email}
                    </TableCell>
                    <TableCell className="text-xs">
                      {u.roles.length > 0 ? (
                        <span>
                          {u.roles.map((r) => r.name).join(", ")}
                        </span>
                      ) : (
                        <span className="text-zinc-400">{t("noRoles")}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        active={u.isActive}
                        tActive={t("filterStatusActive")}
                        tInactive={t("filterStatusInactive")}
                      />
                    </TableCell>
                    <TableCell className="text-xs text-zinc-500 dark:text-zinc-400">
                      {formatter.dateTime(u.createdAt, { dateStyle: "medium" })}
                    </TableCell>
                    <StickyActionsCell>
                      <UserRowActions
                        user={u}
                        isSelf={u.id === user.id}
                        canEdit={canEdit}
                        canDeactivate={canDeactivate}
                        canReactivate={canReactivate}
                        allRoles={roles}
                      />
                    </StickyActionsCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Pagination
        pathname="/admin/users"
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

function TabLink({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
        active
          ? "border-blue-600 text-blue-700 dark:border-blue-500 dark:text-blue-400"
          : "border-transparent text-zinc-600 hover:text-zinc-900 hover:border-zinc-300 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:border-zinc-700",
      )}
    >
      {label}
    </Link>
  );
}

function StatusBadge({
  active,
  tActive,
  tInactive,
}: {
  active: boolean;
  tActive: string;
  tInactive: string;
}) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
        active
          ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-900"
          : "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:border-zinc-800"
      }`}
    >
      {active ? tActive : tInactive}
    </span>
  );
}

