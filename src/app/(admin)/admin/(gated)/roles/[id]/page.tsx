import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditRoleForm } from "@/components/roles/edit-role-form";
import { getRoleDetail } from "@/app/actions/roles";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import {
  ALL_PERMISSIONS,
  type Permission,
} from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function EditRolePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  const { id } = await params;
  const role = await getRoleDetail(id);
  if (!role) notFound();

  const [canUpdate, canDelete] = await Promise.all([
    can(user, "roles.update", { type: "global" }, productionContext),
    can(user, "roles.delete", { type: "global" }, productionContext),
  ]);
  if (!canUpdate) redirect("/admin/roles");

  const callerPermissions = [...user.permissions] as Permission[];
  const callerHasAll = ALL_PERMISSIONS.every((p) => user.permissions.has(p));

  const t = await getTranslations("roles.edit");

  return (
    <div className="max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{role.name}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t("subtitle")}
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>{t("cardTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <EditRoleForm
            roleId={role.id}
            initial={{
              name: role.name,
              description: role.description ?? "",
              permissions: role.permissions,
              isSystem: role.isSystem,
            }}
            callerPermissions={callerPermissions}
            callerHasAll={callerHasAll}
            canDelete={canDelete}
          />
        </CardContent>
      </Card>
    </div>
  );
}
