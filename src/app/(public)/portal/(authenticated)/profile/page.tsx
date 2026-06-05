import type { Metadata } from "next";
import { and, eq, isNotNull } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { AvatarUpload } from "@/components/customer/avatar-upload";
import { CustomerNotificationPrefs } from "@/components/customer/customer-notification-prefs";
import { CustomerPasswordSection } from "@/components/customer/customer-password-section";
import { CustomerProfileForm } from "@/components/customer/customer-profile-form";
import { listMyNotificationPreferences } from "@/app/actions/profile";
import { CUSTOMER_EVENT_TYPES } from "@/lib/notifications/audience";
import { requireSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { accounts, users } from "@/lib/db/schema/auth";
import { getAvatarSignedUrl } from "@/lib/storage/signed-urls";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.profile");
  return { title: t("metaTitle") };
}

export default async function PortalProfilePage() {
  const user = await requireSessionUser();
  const [profile] = await db
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
  const prefs = await listMyNotificationPreferences(CUSTOMER_EVENT_TYPES);
  // image stores the R2 storage key; generate a 1-hour signed URL so the
  // browser can cache it for the session.
  const avatarUrl = profile?.image
    ? await getAvatarSignedUrl(profile.image)
    : null;

  // Does this user have a password set on the credential account?
  // Magic-link-only users will have no row (or one with password=null);
  // password-using users will have a non-null hash here.
  const [cred] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, user.id),
        eq(accounts.providerId, "credential"),
        isNotNull(accounts.password),
      ),
    )
    .limit(1);
  const hasPassword = !!cred;
  const t = await getTranslations("portal.profile");
  const tNotifs = await getTranslations("portal.profile.notifications");

  return (
    <section className="max-w-3xl mx-auto py-10 px-4 space-y-10">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {t("subtitle")}
        </p>
      </div>

      <AvatarUpload
        name={profile?.name ?? ""}
        currentAvatarUrl={avatarUrl}
      />

      <CustomerProfileForm
        initial={{
          name: profile?.name ?? "",
          email: profile?.email ?? "",
          phone: profile?.phone ?? "",
        }}
      />

      <CustomerPasswordSection hasPassword={hasPassword} />

      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {tNotifs("title")}
        </h2>
        <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
          {tNotifs("subtitle")}
        </p>
        <CustomerNotificationPrefs initial={prefs} />
      </div>
    </section>
  );
}
