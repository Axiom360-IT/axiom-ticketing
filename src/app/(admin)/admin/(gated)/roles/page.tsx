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
import { listRolesForAdmin } from "@/app/actions/roles";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function RolesListPage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (!(await can(user, "roles.view", { type: "global" }, productionContext))) {
    redirect("/admin");
  }

  const [rows, canCreate] = await Promise.all([
    listRolesForAdmin(),
    can(user, "roles.create", { type: "global" }, productionContext),
  ]);
  const t = await getTranslations("roles.list");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("subtitle")} · {t("count", { count: rows.length })}
          </p>
        </div>
        {canCreate ? (
          <Button render={<Link href="/admin/roles/new" />}>
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
                <TableHead className="pr-4">
                  {t("columns.description")}
                </TableHead>
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
                  <TableCell className="pr-4 text-xs text-zinc-500 dark:text-zinc-400">
                    {r.description ?? ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
