"use client";

import { type FormEvent, useState } from "react";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { changePassword, setPassword } from "@/app/actions/profile";
import { PasswordInput } from "@/components/ui/password-input";

// Renders one of two flows:
//   - hasPassword = false → "Set a password" (new only, no current). For
//     magic-link-only users who never set a password during sign-up.
//     Once set, the same user reloads and sees the change flow below.
//   - hasPassword = true → "Change password" (current + new). Existing
//     credentials are re-verified by Better Auth.

type Props = {
  hasPassword: boolean;
};

const MIN_LENGTH = 12;

export function CustomerPasswordSection({ hasPassword }: Props) {
  const t = useTranslations("portal.profile.password");
  const tCommon = useTranslations("common");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function reset() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setRevokeOtherSessions(false);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword.length < MIN_LENGTH) {
      setError(t("tooShort", { min: MIN_LENGTH }));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("mismatch"));
      return;
    }

    setSubmitting(true);
    const result = hasPassword
      ? await changePassword({
          currentPassword,
          newPassword,
          revokeOtherSessions,
        })
      : await setPassword({ newPassword });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSuccess(hasPassword ? t("changedSuccess") : t("setSuccess"));
    reset();
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
        <Lock className="size-4" aria-hidden="true" />
        {hasPassword ? t("changeTitle") : t("setTitle")}
      </h2>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        {hasPassword ? t("changeSubtitle") : t("setSubtitle")}
      </p>

      <form onSubmit={handleSubmit} className="space-y-3 max-w-md">
        {hasPassword ? (
          <div>
            <label
              htmlFor="currentPassword"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
            >
              {t("currentLabel")}
            </label>
            <PasswordInput
              id="currentPassword"
              name="currentPassword"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              showLabel={tCommon("showPassword")}
              hideLabel={tCommon("hidePassword")}
            />
          </div>
        ) : null}

        <div>
          <label
            htmlFor="newPassword"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
          >
            {t("newLabel")}
          </label>
          <PasswordInput
            id="newPassword"
            name="newPassword"
            autoComplete="new-password"
            required
            minLength={MIN_LENGTH}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            showLabel={tCommon("showPassword")}
            hideLabel={tCommon("hidePassword")}
          />
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {t("hint", { min: MIN_LENGTH })}
          </p>
        </div>

        <div>
          <label
            htmlFor="confirmPassword"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
          >
            {t("confirmLabel")}
          </label>
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            showLabel={tCommon("showPassword")}
            hideLabel={tCommon("hidePassword")}
          />
        </div>

        {hasPassword ? (
          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={revokeOtherSessions}
              onChange={(e) => setRevokeOtherSessions(e.target.checked)}
              className="size-4 accent-blue-600"
            />
            {t("revokeOthers")}
          </label>
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
        {success ? (
          <div
            role="status"
            className="text-sm text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-900 rounded-md px-3 py-2"
          >
            {success}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {submitting
            ? t("submitting")
            : hasPassword
              ? t("changeSubmit")
              : t("setSubmit")}
        </button>
      </form>
    </div>
  );
}
