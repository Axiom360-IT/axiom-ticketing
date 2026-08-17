import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import {
  Pagination,
  parsePage,
  parsePageSize,
} from "@/components/ui/pagination";
import { UrlFilterSelect } from "@/components/ui/url-filter-select";
import { UrlSearchInput } from "@/components/ui/url-search-input";
import { ExportMenu } from "@/components/shared/export-menu";
import { UsersTable } from "@/components/users/users-table";
import { listAllRoles, listUsersForAdmin } from "@/app/actions/users";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";
import { parseSort, sortRows } from "@/lib/data-table";
import type { InviteStatus } from "@/lib/users/invite-status";
import { cn } from "@/lib/utils";

type Audience = "internal" | "external";
type InviteStatusFilter = InviteStatus | "all";

type SearchParams = Promise<{
  q?: string;
  roleId?: string;
  status?: "active" | "inactive" | "all";
  tab?: Audience;
  inviteStatus?: InviteStatusFilter;
  sort?: string;
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
  const formatter = await getFormatter();

  const sp = await searchParams;
  const { q, roleId, status = "active", tab = "internal", inviteStatus = "all" } = sp;
  const audience: Audience = tab === "external" ? "external" : "internal";
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.pageSize);
  const sort = parseSort(sp.sort, [
    "name",
    "email",
    "roles",
    "status",
    "createdAt",
  ]);

  // For row-action ICON visibility we use the raw permission grant — the
  // per-target check runs server-side when the user clicks.
  const canEdit = user.permissions.has("users.update");
  const canDeactivate = user.permissions.has("users.deactivate");
  const canReactivate = user.permissions.has("users.reactivate");
  const canResetPassword = user.permissions.has("users.reset_password");

  const [allRows, roles, canCreate] = await Promise.all([
    listUsersForAdmin({ query: q, roleId, status, audience, inviteStatus }),
    listAllRoles(),
    can(user, "users.create", { type: "global" }, productionContext),
  ]);

  // listUsersForAdmin filters in JS — sort + paginate the post-filter list.
  const sorted = sortRows(allRows, sort, {
    name: (u) => u.name.toLowerCase(),
    email: (u) => u.email.toLowerCase(),
    roles: (u) => u.roles.map((r) => r.name).join(", ").toLowerCase(),
    status: (u) => (u.isActive ? 1 : 0),
    createdAt: (u) => u.createdAt.getTime(),
  });
  const totalItems = sorted.length;
  const offset = (page - 1) * pageSize;
  const rows = sorted.slice(offset, offset + pageSize).map((u) => ({
    ...u,
    createdLabel: formatter.dateTime(u.createdAt, { dateStyle: "medium" }),
  }));

  function tabHref(target: Audience): string {
    const params = new URLSearchParams();
    params.set("tab", target);
    if (q) params.set("q", q);
    if (roleId) params.set("roleId", roleId);
    if (status !== "active") params.set("status", status);
    if (inviteStatus !== "all") params.set("inviteStatus", inviteStatus);
    return `/admin/users?${params.toString()}`;
  }

  // Carry the active filters so the export matches what's on screen.
  const exportParams: Record<string, string> = { tab: audience };
  if (q) exportParams.q = q;
  if (roleId) exportParams.roleId = roleId;
  if (status !== "active") exportParams.status = status;
  if (inviteStatus !== "all") exportParams.inviteStatus = inviteStatus;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">{t("title")}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("count", { count: totalItems })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu baseHref="/api/users/export" params={exportParams} />
          {canCreate && audience === "external" ? (
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/admin/users/import" />}
            >
              {t("importButton")}
            </Button>
          ) : null}
          {canCreate ? (
            <Button
              nativeButton={false}
              render={<Link href="/admin/users/new" />}
            >
              {t("createButton")}
            </Button>
          ) : null}
        </div>
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

      {/* Search + status scope. The role filter lives in the Roles column. */}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[14rem]">
          <UrlSearchInput
            initialValue={q ?? ""}
            placeholder={t("search")}
            className="max-w-md"
          />
        </div>
        <UrlFilterSelect
          name="status"
          label={t("filterStatus")}
          value={status}
          showAny={false}
          options={[
            { value: "active", label: t("filterStatusActive") },
            { value: "inactive", label: t("filterStatusInactive") },
            { value: "all", label: t("filterStatusAll") },
          ]}
          triggerClassName="w-32"
        />
        <UrlFilterSelect
          name="inviteStatus"
          label={t("filterInviteStatus")}
          value={inviteStatus}
          showAny={false}
          options={[
            { value: "all", label: t("filterInviteStatusAll") },
            { value: "provisioning", label: t("filterInviteStatusProvisioning") },
            { value: "invite_failed", label: t("filterInviteStatusFailed") },
            { value: "invited", label: t("filterInviteStatusInvited") },
            { value: "invite_expired", label: t("filterInviteStatusExpired") },
          ]}
          triggerClassName="w-40"
        />
      </div>

      <UsersTable
        data={rows}
        totalItems={totalItems}
        pageSize={pageSize}
        emptyMessage={t("empty")}
        currentUserId={user.id}
        allRoles={roles}
        canEdit={canEdit}
        canDeactivate={canDeactivate}
        canReactivate={canReactivate}
        enableBulkActions={audience === "external" && canResetPassword}
      />

      <Pagination
        pathname="/admin/users"
        page={page}
        pageSize={pageSize}
        totalItems={totalItems}
        searchParams={new URLSearchParams(
          Object.entries(sp).filter(
            ([, v]) => typeof v === "string" && v.length > 0,
          ) as [string, string][],
        )}
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
