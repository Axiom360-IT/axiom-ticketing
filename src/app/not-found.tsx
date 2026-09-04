import Link from "next/link";
import { getTranslations } from "next-intl/server";

/**
 * Root 404 — the last-resort boundary for a URL matching no route group at all
 * (e.g. /nope). The admin and public groups each have their own not-found so
 * they keep their chrome; this one renders standalone.
 *
 * Unlike global-error.tsx (which REPLACES the root layout and so has no i18n
 * context), this renders inside it — translations are available here.
 */
export default async function RootNotFound() {
  const t = await getTranslations("errors.notFoundPage");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        {t("title")}
      </h1>
      <p className="mt-2 max-w-md text-sm text-zinc-600 dark:text-zinc-400">
        {t("description")}
      </p>
      <Link
        href="/"
        className="mt-6 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        {t("goHome")}
      </Link>
    </div>
  );
}
