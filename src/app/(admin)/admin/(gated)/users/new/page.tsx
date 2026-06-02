import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateUserForm } from "@/components/users/create-user-form";
import { listAllRoles } from "@/app/actions/users";
import { listActiveOrganizations } from "@/app/actions/organizations";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";

async function loadOrgOptions(user: Awaited<ReturnType<typeof getSessionUser>>) {
  if (
    !user ||
    !(await can(user, "organizations.view", { type: "global" }, productionContext))
  ) {
    return [];
  }
  return (await listActiveOrganizations()).map((o) => ({ id: o.id, name: o.name }));
}

export async function generateMetadata() {
  const t = await getTranslations("users.create");
  return { title: t("title") };
}

export default async function NewUserPage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (!(await can(user, "users.create", { type: "global" }, productionContext))) {
    redirect("/admin/users");
  }

  const t = await getTranslations("users.create");
  const [roles, organizations] = await Promise.all([
    listAllRoles(),
    loadOrgOptions(user),
  ]);

  return (
    <div className="max-w-2xl space-y-6">
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
          <CreateUserForm roles={roles} organizations={organizations} />
        </CardContent>
      </Card>
    </div>
  );
}
