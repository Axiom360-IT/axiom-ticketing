import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listAllRoles, listUsersForAdmin } from "@/app/actions/users";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  q?: string;
  roleId?: string;
  status?: "active" | "inactive" | "all";
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

  const { q, roleId, status = "active" } = await searchParams;
  const [rows, roles, canCreate] = await Promise.all([
    listUsersForAdmin({ query: q, roleId, status }),
    listAllRoles(),
    can(user, "users.create", { type: "global" }, productionContext),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("count", { count: rows.length })}
          </p>
        </div>
        {canCreate ? (
          <Button render={<Link href="/admin/users/new" />}>
            {t("createButton")}
          </Button>
        ) : null}
      </div>

      <form
        className="flex flex-wrap gap-2 items-end"
        action="/admin/users"
        method="get"
      >
        <div className="flex-1 min-w-[14rem]">
          <Input
            name="q"
            defaultValue={q ?? ""}
            placeholder={t("search")}
            className="max-w-md"
          />
        </div>

        <RoleFilter roles={roles} initial={roleId} label={t("filterRole")} />

        <StatusFilter
          initial={status}
          label={t("filterStatus")}
          tActive={t("filterStatusActive")}
          tInactive={t("filterStatusInactive")}
          tAll={t("filterStatusAll")}
        />
      </form>

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
                  <TableHead className="pr-4">
                    {t("columns.createdAt")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="px-4">
                      <Link
                        href={`/admin/users/${u.id}`}
                        className="text-blue-600 hover:underline dark:text-blue-400 font-medium"
                      >
                        {u.name}
                      </Link>
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
                    <TableCell className="pr-4 text-xs text-zinc-500 dark:text-zinc-400">
                      {formatter.dateTime(u.createdAt, { dateStyle: "medium" })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
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

function RoleFilter({
  roles,
  initial,
  label,
}: {
  roles: { id: string; name: string }[];
  initial?: string;
  label: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-zinc-500 dark:text-zinc-400">{label}</label>
      <select
        name="roleId"
        defaultValue={initial ?? ""}
        className="h-8 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 text-sm"
      >
        <option value="">{/* all roles */ ""}</option>
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function StatusFilter({
  initial,
  label,
  tActive,
  tInactive,
  tAll,
}: {
  initial?: string;
  label: string;
  tActive: string;
  tInactive: string;
  tAll: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-zinc-500 dark:text-zinc-400">{label}</label>
      <Select name="status" defaultValue={initial ?? "active"}>
        <SelectTrigger className="h-8 w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">{tActive}</SelectItem>
          <SelectItem value="inactive">{tInactive}</SelectItem>
          <SelectItem value="all">{tAll}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
