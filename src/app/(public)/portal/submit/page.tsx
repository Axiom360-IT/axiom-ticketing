import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
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
  const tCommon = await getTranslations("common");

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
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
            {t("title")}
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">{t("subtitle")}</p>
        </header>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-sm p-6 sm:p-8">
          <SubmissionForm
            initialName={initialName}
            initialEmail={initialEmail}
          />
        </div>

        <footer className="mt-8 text-center text-xs text-zinc-500">
          {tCommon("appName")}
        </footer>
      </div>
    </div>
  );
}
