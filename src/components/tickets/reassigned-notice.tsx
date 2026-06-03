"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, X } from "lucide-react";

/**
 * Confirmation banner shown on the ticket queue after a technician reassigns a
 * ticket they can no longer see (they'd otherwise have hit a 404 on the detail
 * page). Reads the assignee name from the `?reassigned=` query param and clears
 * it on dismiss so it doesn't linger on refresh.
 */
export function ReassignedNotice({ name }: { name: string }) {
  const t = useTranslations("tickets.queue");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function dismiss() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("reassigned");
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  }

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300"
    >
      <span className="inline-flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t("reassignedNotice", { name })}
      </span>
      <button
        type="button"
        onClick={dismiss}
        disabled={pending}
        aria-label={t("reassignedDismiss")}
        className="shrink-0 rounded p-0.5 hover:bg-green-100 disabled:opacity-50 dark:hover:bg-green-900/50"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
