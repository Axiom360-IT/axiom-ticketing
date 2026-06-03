"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff } from "lucide-react";
import { signInWithLockout } from "@/app/actions/sign-in";
import { requestMagicLink } from "@/app/actions/customer-portal";

type Mode = "magic" | "password";

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("portal.signIn");
  const errorParam = searchParams.get("error");

  const [mode, setMode] = useState<Mode>("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    errorParam === "expired"
      ? t("errors.expired")
      : errorParam === "missing"
        ? t("errors.missing")
        : null,
  );

  async function handleMagic(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    // Try/catch around the server action so the button never wedges in
    // "Sending…" if the action throws (e.g., transient 500, network blip,
    // page re-render failure during the action response). The `finally`
    // guarantees `submitting` flips back regardless of outcome.
    try {
      const result = await requestMagicLink(email);
      if (!result.ok) {
        const map = {
          invalid_email: t("errors.invalidEmail"),
          rate_limited_email: t("errors.tooManyByEmail"),
          rate_limited_ip: t("errors.tooManyByIp"),
          // Sign-in is existing-accounts-only — point the visitor at the
          // sign-up surface so their name gets captured.
          account_not_found: t("errors.accountNotFound"),
        } as const;
        setError(map[result.error]);
        return;
      }
      router.push(`/portal/sign-in/sent?email=${encodeURIComponent(email)}`);
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[sign-in/magic] action threw:", err);
      }
      setError(t("errors.unexpected"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await signInWithLockout(
        email.trim(),
        password.trim(),
        rememberMe,
      );
      if (!result.ok) {
        if ("locked" in result && result.locked) {
          setError(result.error);
        } else if ("unverified" in result && result.unverified) {
          setError(result.error);
        } else {
          setError(t("errors.invalidCredentials"));
        }
        return;
      }
      router.push("/portal/tickets");
      router.refresh();
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[sign-in/password] action threw:", err);
      }
      setError(t("errors.unexpected"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={mode === "magic" ? handleMagic : handlePassword}
      className="space-y-4"
      noValidate
    >
      <div>
        <label
          htmlFor="email"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
        >
          {t("emailLabel")}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("emailPlaceholder")}
          className="w-full px-3 py-2.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {mode === "password" ? (
        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
          >
            {t("passwordLabel")}
          </label>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 pr-10 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={
                showPassword ? t("hidePassword") : t("showPassword")
              }
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 focus:outline-none focus-visible:text-blue-600"
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
          <label className="mt-3 inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
            />
            {t("rememberMe")}
          </label>
        </div>
      ) : null}

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
        className="w-full px-4 py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        {mode === "magic"
          ? submitting
            ? t("submittingMagic")
            : t("submitMagic")
          : submitting
            ? t("submittingPassword")
            : t("submitPassword")}
      </button>

      <div className="text-center">
        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === "magic" ? "password" : "magic"));
            setError(null);
          }}
          className="text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-2 rounded-sm transition-colors"
        >
          {mode === "magic" ? t("usePassword") : t("forgotPassword")}
        </button>
      </div>
      {/* The "Don't have an account? Create one" + "Submit as guest"
          links are rendered ONCE by the page's footerSlot below the
          card. Repeating them inside the form produced two copies of
          the same line stacked on top of each other. */}
    </form>
  );
}
