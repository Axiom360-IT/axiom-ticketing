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
import { AvatarUpload } from "@/components/customer/avatar-upload";
import { PasswordForm } from "@/components/profile/password-form";
import { PreferencesGrid } from "@/components/profile/preferences-grid";
import { SessionsList } from "@/components/profile/sessions-list";
import {
  listMyNotificationPreferences,
  listMySessions,
} from "@/app/actions/profile";
import { staffEventsForRoles } from "@/lib/notifications/audience";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { getAvatarSignedUrl } from "@/lib/storage/signed-urls";

export default async function ProfilePage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  const [me] = await db
    .select({
      name: users.name,
      email: users.email,
      language: users.language,
      phone: users.phone,
      image: users.image,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!me) redirect("/admin/login");

  // Scope the notification grid to the events this user's role(s) actually
  // receive — a Technician shouldn't see Coordinator/Director-only toggles
  // (req 6.4). Customers are already scoped to CUSTOMER_EVENT_TYPES on the
  // portal profile.
  const [sessions, prefs] = await Promise.all([
    listMySessions(),
    listMyNotificationPreferences(staffEventsForRoles(user.roleNames)),
  ]);

  // image stores the R2 storage key; sign with 1h TTL for browser caching.
  const avatarUrl = me.image ? await getAvatarSignedUrl(me.image) : null;

  const t = await getTranslations("profile");

  return (
    <div className="space-y-6 max-w-3xl">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold sm:text-2xl">{t("page.title")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t("page.subtitle")}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("account.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <AvatarUpload name={me.name} currentAvatarUrl={avatarUrl} />
          <AccountForm
            initial={{
              name: me.name,
              email: me.email,
              phone: me.phone ?? "",
            }}
          />
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
