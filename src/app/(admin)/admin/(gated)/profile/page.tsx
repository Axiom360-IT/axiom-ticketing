import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AccountForm } from "@/components/profile/account-form";
import { PasswordForm } from "@/components/profile/password-form";
import { PreferencesGrid } from "@/components/profile/preferences-grid";
import { SessionsList } from "@/components/profile/sessions-list";
import {
  listMyNotificationPreferences,
  listMySessions,
} from "@/app/actions/profile";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  const [me] = await db
    .select({
      name: users.name,
      email: users.email,
      language: users.language,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!me) redirect("/admin/login");

  const [sessions, prefs] = await Promise.all([
    listMySessions(),
    listMyNotificationPreferences(),
  ]);

  const t = await getTranslations("profile");

  return (
    <div className="space-y-6 max-w-3xl">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t("page.subtitle")}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("account.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <AccountForm initial={me} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("password.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("sessions.title")}</CardTitle>
          <CardDescription>{t("sessions.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SessionsList initial={sessions} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("preferences.title")}</CardTitle>
          <CardDescription>{t("preferences.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <PreferencesGrid initial={prefs} />
        </CardContent>
      </Card>
    </div>
  );
}
