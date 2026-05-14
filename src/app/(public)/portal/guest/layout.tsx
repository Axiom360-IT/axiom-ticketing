import Link from "next/link";
import { getTranslations } from "next-intl/server";

// Minimal chrome for token-authenticated guest views. Deliberately
// omits the "Signed in as…" topbar since the visitor doesn't have a
// session — and avoids any cross-link into the registered portal so
// guests don't dead-end at a sign-in wall.

export default async function GuestPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("common");
  const tGuest = await getTranslations("portal.guest");
  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link
            href="/portal/submit"
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 hover:underline"
          >
            {t("appName")}
          </Link>
          <Link
            href="/portal/sign-in"
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            {tGuest("signInLink")}
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-zinc-200 dark:border-zinc-800 py-4 text-center text-xs text-zinc-500">
        {tGuest("footerHint")}
      </footer>
    </div>
  );
}
