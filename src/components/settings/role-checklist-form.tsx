"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useReauthGate } from "@/components/shared/use-reauth-gate";
import { updateSetting } from "@/app/actions/settings";
import { cn } from "@/lib/utils";

type Props = {
  settingKey: string;
  /** Every staff role name the admin can pick from. */
  allRoles: string[];
  /** Currently-selected role names. */
  initial: string[];
  /** Shown when there are no roles to choose from. */
  emptyHint: string;
};

/**
 * Checklist of staff roles persisted as a string[] setting. Each toggle saves
 * the whole array (behind the reauth gate, like the other settings forms).
 */
export function RoleChecklistForm({
  settingKey,
  allRoles,
  initial,
  emptyHint,
}: Props) {
  const router = useRouter();
  const { runWithReauth, gate } = useReauthGate();
  const [selected, setSelected] = useState<string[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(role: string, checked: boolean) {
    const next = checked
      ? [...selected, role]
      : selected.filter((r) => r !== role);
    const previous = selected;
    setSelected(next); // optimistic
    startTransition(async () => {
      setError(null);
      const res = await runWithReauth(
        () => updateSetting(settingKey, next),
        "settings",
      );
      if (!res.ok) {
        setSelected(previous);
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  if (allRoles.length === 0) {
    return <p className="text-xs text-zinc-500 dark:text-zinc-400">{emptyHint}</p>;
  }

  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-2">
        {allRoles.map((role) => {
          const checked = selected.includes(role);
          return (
            <li key={role}>
              <label
                className={cn(
                  "inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
                  checked
                    ? "border-blue-400 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200"
                    : "border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900",
                  isPending && "opacity-60",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => toggle(role, e.target.checked)}
                  disabled={isPending}
                  className="size-3.5 accent-blue-600"
                />
                <span>{role}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {gate}
    </div>
  );
}
