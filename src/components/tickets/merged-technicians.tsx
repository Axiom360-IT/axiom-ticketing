"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { removeMergedTechnician } from "@/app/actions/ticket-assignees";

type Tech = { id: string; name: string };

/**
 * Displays BOTH technicians on a merged ticket (req 4.4) — the primary plus the
 * merge co-assignee(s) — and, for a Superadmin, lets them remove either one
 * (req 4.5). Only rendered when co-assignees exist (i.e. a merged ticket).
 */
export function MergedTechnicians({
  ticketId,
  primary,
  coAssignees,
  canManage,
}: {
  ticketId: string;
  primary: Tech | null;
  coAssignees: Tech[];
  canManage: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("tickets.mergedTechs");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(userId: string) {
    setError(null);
    startTransition(async () => {
      const res = await removeMergedTechnician(ticketId, userId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  const rows: { tech: Tech; isPrimary: boolean }[] = [];
  if (primary) rows.push({ tech: primary, isPrimary: true });
  for (const c of coAssignees) rows.push({ tech: c, isPrimary: false });

  return (
    <div className="space-y-2 border-t border-zinc-200 pt-2 dark:border-zinc-800">
      <p className="text-xs text-zinc-600 dark:text-zinc-400">{t("label")}</p>
      <ul className="flex flex-wrap gap-1.5">
        {rows.map(({ tech, isPrimary }) => (
          <li
            key={tech.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 py-0.5 pl-2.5 pr-1 text-xs dark:border-zinc-800 dark:bg-zinc-900"
          >
            <span className="font-medium">{tech.name}</span>
            <span
              className={cn(
                "rounded-full px-1.5 py-px text-[10px] font-medium uppercase tracking-wide",
                isPrimary
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                  : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
              )}
            >
              {isPrimary ? t("primary") : t("merged")}
            </span>
            {canManage ? (
              <button
                type="button"
                onClick={() => remove(tech.id)}
                disabled={pending}
                className="rounded-full p-0.5 hover:bg-zinc-200 disabled:opacity-50 dark:hover:bg-zinc-700"
                aria-label={t("removeLabel", { name: tech.name })}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
