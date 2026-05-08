"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

type Props = {
  pending: boolean;
  saved: boolean;
  error: string | null;
};

export function SaveRow({ pending, saved, error }: Props) {
  const t = useTranslations("settings.actions");
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Button type="submit" disabled={pending}>
        {pending ? t("saving") : t("save")}
      </Button>
      {saved ? (
        <span className="text-xs text-green-700 dark:text-green-400">
          {t("saved")}
        </span>
      ) : null}
      {error ? (
        <span
          role="alert"
          className="text-xs text-red-600 dark:text-red-400"
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}
