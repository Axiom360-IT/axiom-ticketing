import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.signUpVerify");
  return { title: t("metaTitle") };
}

// Landing page right after the customer submits the sign-up form.
// Account exists, credentials are stored, but `emailVerified=false` so
// Better Auth won't let them sign in until they click the verification
// link in the email we just sent.

export default async function PortalSignUpVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  const t = await getTranslations("portal.signUpVerify");
  return (
    <section className="max-w-md mx-auto py-16 px-4 text-center">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        {t("title")}
      </h1>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        {t("body", { email: email ?? "" })}
      </p>
      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-500">
        {t("hint")}
      </p>
      <div className="mt-8 flex flex-col gap-3 items-center">
        <Link
          href="/portal/sign-in"
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          {t("backToSignIn")}
        </Link>
      </div>
    </section>
  );
}
