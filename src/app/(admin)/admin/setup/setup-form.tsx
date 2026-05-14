"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { setupPassword } from "@/app/actions/setup";

type Props = {
  token: string;
};

export function SetupForm({ token }: Props) {
  const router = useRouter();
  const t = useTranslations("admin.setup");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError(t("errorTooShort"));
      return;
    }
    if (password !== confirm) {
      setError(t("errorMismatch"));
      return;
    }
    setSubmitting(true);
    const result = await setupPassword({ token, newPassword: password });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Reset succeeded — push to login. The success flag tells the
    // login page to surface a one-time confirmation banner.
    router.push("/admin/login?reset=ok");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label
          htmlFor="setup-password"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
        >
          {t("passwordLabel")}
        </label>
        <input
          id="setup-password"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {t("passwordHint")}
        </p>
      </div>

      <div>
        <label
          htmlFor="setup-confirm"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
        >
          {t("confirmLabel")}
        </label>
        <input
          id="setup-confirm"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full px-3 py-2.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {error ? (
        <div
          role="alert"
          aria-live="polite"
          className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 rounded-md px-3 py-2"
        >
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="w-full px-4 py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 min-h-[44px]"
      >
        {submitting ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
