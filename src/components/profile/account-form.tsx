"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfile } from "@/app/actions/profile";

type Props = {
  initial: { name: string; email: string; language: string };
};

export function AccountForm({ initial }: Props) {
  const router = useRouter();
  const t = useTranslations("profile.account");

  const [name, setName] = useState(initial.name);
  const [language, setLanguage] = useState(initial.language);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await updateProfile({ name, language });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="profile-name">{t("name")}</Label>
          <Input
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profile-email">{t("email")}</Label>
          <Input
            id="profile-email"
            value={initial.email}
            disabled
            readOnly
          />
        </div>
      </div>
      <div className="space-y-1.5 max-w-xs">
        <Label htmlFor="profile-language">{t("language")}</Label>
        <Input
          id="profile-language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          maxLength={10}
        />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <Button type="submit" disabled={isPending}>
          {isPending ? t("saving") : t("save")}
        </Button>
        {saved ? (
          <span className="text-xs text-green-700 dark:text-green-400">
            {t("saved")}
          </span>
        ) : null}
        {error ? (
          <span role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
