"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePassword } from "@/app/actions/profile";

export function PasswordForm() {
  const router = useRouter();
  const t = useTranslations("profile.password");

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [revokeOthers, setRevokeOthers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (next !== confirm) {
      setError(t("mismatch"));
      return;
    }
    startTransition(async () => {
      const res = await changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: revokeOthers,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="pw-current">{t("currentPassword")}</Label>
        <Input
          id="pw-current"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
          autoComplete="current-password"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pw-new">{t("newPassword")}</Label>
        <Input
          id="pw-new"
          type="password"
          minLength={12}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
          autoComplete="new-password"
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {t("passwordHint")}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pw-confirm">{t("confirmPassword")}</Label>
        <Input
          id="pw-confirm"
          type="password"
          minLength={12}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          autoComplete="new-password"
        />
      </div>
      <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          checked={revokeOthers}
          onChange={(e) => setRevokeOthers(e.target.checked)}
        />
        <span>{t("revokeOthers")}</span>
      </label>
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
