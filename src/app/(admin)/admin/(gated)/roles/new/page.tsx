import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateRoleForm } from "@/components/roles/create-role-form";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import {
  ALL_PERMISSIONS,
  type Permission,
} from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("roles.create");
  return { title: t("title") };
}

export default async function NewRolePage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (
    !(await can(user, "roles.create", { type: "global" }, productionContext))
  ) {
    redirect("/admin/roles");
  }

  const callerPermissions = [...user.permissions] as Permission[];
  const callerHasAll = ALL_PERMISSIONS.every((p) => user.permissions.has(p));

  const t = await getTranslations("roles.create");

  return (
    <div className="max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t("subtitle")}
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>{t("cardTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateRoleForm
            callerPermissions={callerPermissions}
            callerHasAll={callerHasAll}
          />
        </CardContent>
      </Card>
    </div>
  );
}
