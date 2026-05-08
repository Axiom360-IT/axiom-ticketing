import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { TwoFactorSection } from "@/components/profile/two-factor-section";
import { isPrivilegedUser } from "@/lib/auth/twofactor";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { ForcedSignOutButton } from "./sign-out-button";

export const dynamic = "force-dynamic";

// Forced 2FA enrolment screen for privileged users (M17 Phase A).
// Only the (gated) layout enforces redirect-to-here, so this route lives
// outside that group and shows a minimal full-screen enrolment card with
// no sidebar/nav. The only way out is to enrol or to sign out.

export default async function TwoFactorRequiredPage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  // If a non-privileged user landed here directly, send them home.
  if (!isPrivilegedUser(user)) redirect("/admin");

  const [me] = await db
    .select({ twoFactorEnabled: users.twoFactorEnabled })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  // Already enrolled — they shouldn't be on this page.
  if (me?.twoFactorEnabled) redirect("/admin");

  const t = await getTranslations("profile.twoFactorRequired");

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
      <div className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-8 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            {t("title")}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("subtitle")}
          </p>
        </header>

        <TwoFactorSection enabled={false} canDisable={false} />

        <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
          <ForcedSignOutButton />
        </div>
      </div>
    </div>
  );
}
