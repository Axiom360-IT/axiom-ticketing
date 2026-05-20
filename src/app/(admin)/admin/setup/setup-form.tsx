"use client";

import { type FormEvent, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { setupPassword } from "@/app/actions/setup";

type Props = {
  token: string;
  /** Email carried in the setup URL. When present, a successful reset
   *  is followed by an auto-sign-in so the user lands on `/admin`
   *  directly instead of bouncing through the login form. */
  email?: string;
};

export function SetupForm({ token, email }: Props) {
  const router = useRouter();
  const t = useTranslations("admin.setup");
  // The eye-toggle button reuses copy from the login surface; the
  // setup namespace doesn't ship its own a11y strings for this control.
  const tLogin = useTranslations("admin.login");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
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
    const result = await setupPassword({ token, newPassword: password, email });
    if (!result.ok) {
      setSubmitting(false);
      setError(result.error);
      return;
    }
    // Don't flip `submitting` back to false before navigation — that
    // briefly re-enables the button and lets a fast double-clicker
    // re-submit a now-consumed token. Leave the button disabled and
    // navigate. router.push + refresh runs synchronously here.
    if (result.signedIn) {
      router.push("/admin");
    } else {
      router.push("/admin/login?reset=ok");
    }
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
        <div className="relative">
          <input
            id="setup-password"
            type={showPassword ? "text" : "password"}
            required
            minLength={12}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2.5 pr-10 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? tLogin("hidePassword") : tLogin("showPassword")}
            aria-pressed={showPassword}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {showPassword ? (
              <EyeOff size={18} aria-hidden="true" />
            ) : (
              <Eye size={18} aria-hidden="true" />
            )}
          </button>
        </div>
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
        <div className="relative">
          <input
            id="setup-confirm"
            type={showConfirm ? "text" : "password"}
            required
            minLength={12}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full px-3 py-2.5 pr-10 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => setShowConfirm((v) => !v)}
            aria-label={showConfirm ? tLogin("hidePassword") : tLogin("showPassword")}
            aria-pressed={showConfirm}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {showConfirm ? (
              <EyeOff size={18} aria-hidden="true" />
            ) : (
              <Eye size={18} aria-hidden="true" />
            )}
          </button>
        </div>
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
