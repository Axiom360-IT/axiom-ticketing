"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useTranslations } from "next-intl";
import PhoneInput from "react-phone-number-input";
import { requestSignUpMagicLink } from "@/app/actions/customer-portal";

const MIN_PASSWORD = 12;

export function SignUpForm() {
  const router = useRouter();
  const t = useTranslations("portal.signUp");
  const tSignIn = useTranslations("portal.signIn");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) {
      setError(t("errors.passwordTooShort"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("errors.passwordMismatch"));
      return;
    }
    setSubmitting(true);
    try {
      const result = await requestSignUpMagicLink(name, email, phone, password);
      if (!result.ok) {
        const map = {
          invalid_email: tSignIn("errors.invalidEmail"),
          invalid_name: tSignIn("errors.invalidEmail"),
          invalid_phone: t("errors.invalidPhone"),
          invalid_password: t("errors.passwordTooShort"),
          rate_limited_email: tSignIn("errors.tooManyByEmail"),
          rate_limited_ip: tSignIn("errors.tooManyByIp"),
          account_exists: t("errors.accountExists"),
          signup_failed: tSignIn("errors.unexpected"),
        } as const;
        setError(map[result.error]);
        return;
      }
      // Account is created but `emailVerified=false`. Better Auth blocks
      // sign-in until the user clicks the verification link in the
      // email we just sent — so send them to a "check your inbox" page
      // instead of the portal.
      router.push(`/portal/sign-up/verify?email=${encodeURIComponent(email)}`);
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[sign-up] action threw:", err);
      }
      setError(tSignIn("errors.unexpected"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label
          htmlFor="name"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
        >
          {t("nameLabel")}
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("namePlaceholder")}
          className="w-full px-3 py-2.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

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

      <div>
        <label
          htmlFor="phone"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
        >
          {t("phoneLabel")}
          <span className="ml-1 text-xs font-normal text-zinc-500 dark:text-zinc-400">
            {t("phoneOptional")}
          </span>
        </label>
        <PhoneInput
          id="phone"
          // Default to Pakistan (matches the current deployment). Users
          // in other countries can change the dropdown — react-phone-
          // number-input remembers the choice for the session.
          defaultCountry="PK"
          international
          autoComplete="tel"
          value={phone || undefined}
          onChange={(v) => setPhone(v ?? "")}
          placeholder={t("phonePlaceholder")}
        />
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {t("phoneHint")}
        </p>
      </div>

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
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          maxLength={200}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("passwordPlaceholder")}
          className="w-full px-3 py-2.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {t("passwordHint", { min: MIN_PASSWORD })}
        </p>
      </div>

      <div>
        <label
          htmlFor="confirmPassword"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
        >
          {t("confirmPasswordLabel")}
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          maxLength={200}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder={t("confirmPasswordPlaceholder")}
          className="w-full px-3 py-2.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
        className="w-full px-4 py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        {submitting ? t("submitting") : t("submit")}
      </button>

      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        {t("alreadyHave")}{" "}
        <a
          href="/portal/sign-in"
          className="text-blue-600 dark:text-blue-400 hover:underline"
        >
          {t("signInLink")}
        </a>
      </p>
    </form>
  );
}
