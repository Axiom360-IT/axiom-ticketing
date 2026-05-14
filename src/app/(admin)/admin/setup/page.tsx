import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SetupForm } from "./setup-form";

// Landing page for the welcome / password-reset email link. Lives
// OUTSIDE the (gated) layout so unauthenticated users can land here.
// The token is verified at submit time by Better Auth's
// `auth.api.resetPassword` — we don't gate the form render on it
// because Better Auth's token is opaque to us. Invalid tokens fail at
// submit with a clear error.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.setup");
  return {
    title: t("metaTitle"),
    robots: { index: false, follow: false },
  };
}

type SearchParams = Promise<{ token?: string }>;

export default async function SetupPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { token } = await searchParams;
  const t = await getTranslations("admin.setup");

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4">
        <div className="max-w-md w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-8 text-center">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
            {t("missingTokenTitle")}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
            {t("missingTokenBody")}
          </p>
          <Link
            href="/admin/login"
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            {t("goToLogin")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4 py-12">
      <div className="max-w-md w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-8">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50 mb-1">
          {t("title")}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
          {t("subtitle")}
        </p>
        <SetupForm token={token} />
      </div>
    </div>
  );
}
