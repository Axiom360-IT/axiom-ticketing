"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

type Props = {
  pending: boolean;
  saved: boolean;
  error: string | null;
};

export function SaveRow({ pending, saved, error }: Props) {
  const t = useTranslations("settings.actions");

  // Show only one status at a time. Error always wins — if the latest
  // submit failed, lingering "Saved" from a previous success would be
  // misleading. Without this guard you can end up with both visible
  // because `setSaved(false)` happens outside `startTransition` while
  // `setError(…)` happens inside it, and React commits the transition
  // batch after the pre-transition render, so for one frame both are
  // truthy.
  const showSaved = saved && !error;

  // Auto-fade "Saved." after a short delay. Industry-standard UX, and
  // it also prevents the stale-state collision above from being visible
  // long enough for anyone to notice on the next submit. We re-sync to
  // the external `saved` prop via a ref-derived effect rather than a
  // direct setState-in-effect (which React 19's lint rule forbids).
  const [autoHidden, setAutoHidden] = useState(false);
  useEffect(() => {
    if (!showSaved) return;
    const id = setTimeout(() => setAutoHidden(true), 2500);
    return () => {
      clearTimeout(id);
      setAutoHidden(false);
    };
  }, [showSaved]);
  const visibleSaved = showSaved && !autoHidden;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Button type="submit" disabled={pending}>
        {pending ? t("saving") : t("save")}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      ) : visibleSaved ? (
        <span className="text-xs text-green-700 dark:text-green-400">
          {t("saved")}
        </span>
      ) : null}
    </div>
  );
}
