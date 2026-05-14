import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SignUpForm } from "./sign-up-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.signUp");
  return { title: t("metaTitle") };
}

export default async function PortalSignUpPage() {
  const t = await getTranslations("portal.signUp");
  return (
    <section className="max-w-md mx-auto py-16 px-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        {t("title")}
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {t("subtitle")}
      </p>
      <div className="mt-8">
        <Suspense>
          <SignUpForm />
        </Suspense>
      </div>
    </section>
  );
}
