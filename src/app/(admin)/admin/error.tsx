"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

// Catches a failure in the admin LAYOUT (session, shell, sidebar, top bar).
//
// `(gated)/error.tsx` cannot: an error boundary only covers what is rendered
// INSIDE its segment, so a throw from `(gated)/layout.tsx` itself skipped it
// and landed on the blank root `global-error` page. This one sits one level up,
// so a layout failure now shows an in-app message with a retry instead.
export default function AdminError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const t = useTranslations("errors.admin");

  useEffect(() => {
    console.error("[admin/error.tsx]", error.digest ?? "(no digest)", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        {t("title")}
      </h1>
      <p className="mt-2 max-w-md text-sm text-zinc-600 dark:text-zinc-400">
        {t("description")}
      </p>
      <button
        type="button"
        onClick={() => unstable_retry()}
        className="mt-6 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        {t("tryAgain")}
      </button>
    </div>
  );
}
