import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth/session";

export default async function AdminLanding() {
  const user = await getSessionUser();
  const t = await getTranslations("admin.landing");

  const roleList =
    user && user.roleNames.size > 0
      ? [...user.roleNames].join(", ")
      : t("noRoles");

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold mb-2">{t("welcome")}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">{t("subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("sessionTitle")}</CardTitle>
          <CardDescription>{t("sessionDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <span className="font-medium">{t("userIdLabel")}</span>{" "}
            <code className="font-mono text-xs">{user?.id}</code>
          </div>
          <div>
            <span className="font-medium">{t("rolesLabel")}</span> {roleList}
          </div>
          <div>
            <span className="font-medium">{t("permissionsLabel")}</span>{" "}
            <span className="text-zinc-500">
              {t("permissionsActive", { count: user?.permissions.size ?? 0 })}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
