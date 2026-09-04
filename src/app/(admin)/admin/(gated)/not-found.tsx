import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * 404 inside the admin shell. Because it lives under (gated), the sidebar and
 * topbar stay rendered — an admin who mistypes a URL or follows a stale link
 * keeps their navigation instead of being dumped on Next's bare default page.
 *
 * Reached both by genuinely unknown URLs and by every notFound() call in the
 * gated tree (a deleted ticket, a user id that no longer exists, or an audit
 * entry whose target has since been removed).
 */
export default async function AdminNotFound() {
  const t = await getTranslations("errors.adminNotFound");

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <SearchX
        className="size-10 text-zinc-400 dark:text-zinc-500"
        aria-hidden="true"
      />
      <h1 className="mt-4 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        {t("title")}
      </h1>
      <p className="mt-2 max-w-md text-sm text-zinc-600 dark:text-zinc-400">
        {t("description")}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/admin"
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("backToDashboard")}
        </Link>
        <Link
          href="/admin/tickets"
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          {t("goToTickets")}
        </Link>
      </div>
    </div>
  );
}
