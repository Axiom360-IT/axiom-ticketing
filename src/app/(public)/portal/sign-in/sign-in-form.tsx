"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useTranslations } from "next-intl";
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
    const result = await requestMagicLink(email);
    setSubmitting(false);
    if (!result.ok) {
      const map = {
        invalid_email: t("errors.invalidEmail"),
        rate_limited_email: t("errors.tooManyByEmail"),
        rate_limited_ip: t("errors.tooManyByIp"),
      } as const;
      setError(map[result.error]);
      return;
    }
    router.push(`/portal/sign-in/sent?email=${encodeURIComponent(email)}`);
  }

  async function handlePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await signInWithLockout(email.trim(), password.trim());
    setSubmitting(false);
    if (!result.ok) {
      setError(
        "locked" in result && result.locked
          ? result.error
          : t("errors.invalidCredentials"),
      );
      return;
    }
    router.push("/portal/tickets");
    router.refresh();
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
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
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

      <button
        type="button"
        onClick={() => {
          setMode((m) => (m === "magic" ? "password" : "magic"));
          setError(null);
        }}
        className="block mx-auto text-sm text-blue-600 dark:text-blue-400 hover:underline focus:outline-none focus:underline"
      >
        {mode === "magic" ? t("usePassword") : t("useMagic")}
      </button>

      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        {t("noAccount")}{" "}
        <a
          href="/portal/sign-up"
          className="text-blue-600 dark:text-blue-400 hover:underline"
        >
          {t("signUpLink")}
        </a>
      </p>
    </form>
  );
}
