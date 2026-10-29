import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditRoleForm } from "@/components/roles/edit-role-form";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import {
  ALL_PERMISSIONS,
  type Permission,
} from "@/lib/auth/permissions";
import { canManageRank, isAtLeastSuperAdmin, rankOf } from "@/lib/auth/rank";
import { getSessionUser } from "@/lib/auth/session";
import { getUndelegableDisplay } from "@/lib/auth/undelegable-display";
import { loadRoleDetail } from "@/lib/roles/detail";

export default async function EditRolePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  const { id } = await params;
  // The FULL permission set, not the policy-filtered one the browser-callable
  // `getRoleDetail` returns: this form must resubmit permissions the editor
  // cannot see, or saving would silently strip them.
  const role = await loadRoleDetail(id);
  if (!role) notFound();

  const display = await getUndelegableDisplay();
  const callerRank = rankOf(user);
  // Under `hidden`, a role ranked above the caller does not exist as far as
  // they can tell — the same answer as a role that really does not exist.
  if (display === "hidden" && role.rank > callerRank) notFound();

  const [canUpdate, canDelete] = await Promise.all([
    can(user, "roles.update", { type: "global" }, productionContext),
    can(user, "roles.delete", { type: "global" }, productionContext),
  ]);
  if (!canUpdate) redirect("/admin/roles");

  const canEditRole = canManageRank(callerRank, role.rank);
  const callerPermissions = [...user.permissions] as Permission[];
  const callerHasAll = ALL_PERMISSIONS.every((p) => user.permissions.has(p));

  const t = await getTranslations("roles.edit");

  return (
    <div className="max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold break-words sm:text-2xl">{role.name}</h1>
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
            display={display}
            canEditRole={canEditRole}
            canEditPermissions={
              canEditRole && !(role.isSystem && !isAtLeastSuperAdmin(user))
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
