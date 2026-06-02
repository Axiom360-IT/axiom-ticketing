"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import PhoneInput from "react-phone-number-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfile } from "@/app/actions/profile";

type Props = {
  initial: { name: string; email: string; phone: string };
};

export function AccountForm({ initial }: Props) {
  const router = useRouter();
  const t = useTranslations("profile.account");

  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await updateProfile({ name, phone: phone.trim() });
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
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="profile-phone">
            {t("phone")}
            <span className="ml-1 text-xs font-normal text-zinc-500">
              {t("phoneOptional")}
            </span>
          </Label>
          <PhoneInput
            id="profile-phone"
            defaultCountry="PK"
            international
            autoComplete="tel"
            value={phone || undefined}
            onChange={(v) => setPhone(v ?? "")}
            placeholder={t("phonePlaceholder")}
          />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("phoneHint")}
          </p>
        </div>
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
