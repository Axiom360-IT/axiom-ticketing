"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useTranslations } from "next-intl";
import PhoneInput from "react-phone-number-input";
import { updateProfile } from "@/app/actions/profile";

type Props = {
  initial: { name: string; email: string; phone: string };
};

export function CustomerProfileForm({ initial }: Props) {
  const router = useRouter();
  const t = useTranslations("portal.profile");

  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSubmitting(true);
    const result = await updateProfile({
      name: name.trim(),
      phone: phone.trim(),
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
      <div>
        <label
          htmlFor="profile-name"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
        >
          {t("nameLabel")}
        </label>
        <input
          id="profile-name"
          type="text"
          required
          minLength={1}
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label
          htmlFor="profile-email"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
        >
          {t("emailLabel")}
        </label>
        <input
          id="profile-email"
          type="email"
          value={initial.email}
          disabled
          className="w-full px-3 py-2.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 cursor-not-allowed"
        />
      </div>
      <div>
        <label
          htmlFor="profile-phone"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
        >
          {t("phoneLabel")}
          <span className="ml-1 text-xs font-normal text-zinc-500 dark:text-zinc-400">
            {t("phoneOptional")}
          </span>
        </label>
        <PhoneInput
          id="profile-phone"
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

      {error ? (
        <div
          role="alert"
          aria-live="polite"
          className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 rounded-md px-3 py-2"
        >
          {error}
        </div>
      ) : null}

      {saved ? (
        <div
          role="status"
          aria-live="polite"
          className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-900 rounded-md px-3 py-2"
        >
          {t("saved")}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="px-4 py-2.5 rounded-md bg-blue-600 min-h-[44px] hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        {submitting ? t("saving") : t("save")}
      </button>
    </form>
  );
}
