"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { updateSetting } from "@/app/actions/settings";
import { useReauthGate } from "@/components/shared/use-reauth-gate";
import { cn } from "@/lib/utils";

/**
 * The on/off switch for one scheduled automation.
 *
 * Writes through `updateSetting`, the same gate the Settings page uses — so it
 * inherits the validation, the rate limit, the audit entry and the password
 * re-confirmation. Switching off a job that decides whether customers get
 * chased is a settings change, not a UI preference, and should feel like one.
 */
export function AutomationToggle({
  settingKey,
  enabled,
  label,
}: {
  settingKey: string;
  enabled: boolean;
  label: string;
}) {
  const router = useRouter();
  const t = useTranslations("automations");
  const { runWithReauth, gate } = useReauthGate();
  const [on, setOn] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function flip() {
    const next = !on;
    setError(null);
    // Optimistic, then reconciled by the refresh — a toggle that waits a
    // second before moving reads as unresponsive.
    setOn(next);
    startTransition(async () => {
      const res = await runWithReauth(
        () => updateSetting(settingKey, next),
        "settings",
      );
      if (!res.ok) {
        setOn(!next);
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={isPending}
        onClick={flip}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50",
          on
            ? "bg-emerald-500 dark:bg-emerald-600"
            : "bg-zinc-300 dark:bg-zinc-700",
        )}
      >
        <span
          className={cn(
            "inline-block size-4 transform rounded-full bg-white transition-transform",
            on ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </button>
      <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
        {on ? t("on") : t("off")}
      </span>
      {error ? (
        <span role="alert" className="text-[10px] text-red-600 dark:text-red-400">
          {error}
        </span>
      ) : null}
      {gate}
    </div>
  );
}
