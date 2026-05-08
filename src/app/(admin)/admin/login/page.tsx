import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const t = await getTranslations("admin.login");
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-8">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {t("subtitle")}
          </p>
        </header>
        <Suspense fallback={<LoginFormFallback />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}

function LoginFormFallback() {
  return (
    <div className="space-y-4">
      <div className="h-9 bg-zinc-100 dark:bg-zinc-800 rounded-md animate-pulse" />
      <div className="h-9 bg-zinc-100 dark:bg-zinc-800 rounded-md animate-pulse" />
      <div className="h-10 bg-zinc-100 dark:bg-zinc-800 rounded-md animate-pulse" />
    </div>
  );
}
