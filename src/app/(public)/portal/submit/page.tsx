import Link from "next/link";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/branding/auth-shell";
import { loadBranding } from "@/lib/branding/load";
import { ACCENT_CLASSES } from "@/lib/branding/presets";
import { SubmissionForm } from "./submission-form";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";

// Public ticket-submission entry point. Per spec §7.1 the form must
// work both anonymously AND for signed-in visitors. We never redirect
// — the server still treats the submission as a public/web_form
// ticket. Signed-in users get their name/email pre-filled as a UX
// convenience; identity is NOT trusted from the form for security
// (Turnstile + honeypot + rate limits + email verification gate the
// submit), so prefill is purely cosmetic.

export async function generateMetadata() {
  const t = await getTranslations("tickets.submit");
  return {
    title: t("title"),
    description: t("subtitle"),
  };
}

export default async function SubmitPage() {
  const t = await getTranslations("tickets.submit");
  const branding = await loadBranding();
  const link = ACCENT_CLASSES[branding.accentColor].link;

  const session = await getSessionUser();
  let initialName = "";
  let initialEmail = "";
  if (session) {
    const [profile] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, session.id))
      .limit(1);
    initialName = profile?.name ?? "";
    initialEmail = profile?.email ?? "";
  }

  return (
    <AuthShell branding={branding} width="wide">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-zinc-900 dark:text-zinc-50">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {t("subtitle")}
          </p>
        </div>
        {/* Signed-in users see their identity confirmation; guests get
            an inline nudge that signing in is an option. */}
        {session ? (
          <span className="shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900">
            {t("signedInAs", { email: initialEmail })}
          </span>
        ) : (
          <p className="shrink-0 text-xs sm:text-sm text-zinc-600 dark:text-zinc-400">
            <span>{t("haveAccountPrompt")} </span>
            <Link
              href="/portal/sign-in"
              className={`font-medium whitespace-nowrap ${link}`}
            >
              {t("haveAccountLink")}
            </Link>
          </p>
        )}
      </header>

      <SubmissionForm initialName={initialName} initialEmail={initialEmail} />
    </AuthShell>
  );
}
