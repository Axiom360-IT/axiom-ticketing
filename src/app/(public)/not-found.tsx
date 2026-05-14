import Link from "next/link";
import { useTranslations } from "next-intl";

export default function PublicNotFound() {
  const t = useTranslations("errors.notFoundPage");

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        {t("title")}
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 max-w-md">
        {t("description")}
      </p>
      <Link
        href="/"
        className="mt-6 px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        {t("goHome")}
      </Link>
    </div>
  );
}
