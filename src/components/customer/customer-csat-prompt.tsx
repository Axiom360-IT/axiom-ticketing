"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, ThumbsDown, ThumbsUp } from "lucide-react";
import { submitCsatFromPortal } from "@/app/actions/customer-portal";

// Inline CSAT prompt on the customer ticket detail page. Shown when:
//   1. `ticket.status === "resolved"`, AND
//   2. `ticket.csatResponse IS NULL` (no feedback yet).
//
// On "Yes, this fixed it" → ticket closes immediately (newStatus=closed).
// On "No, still not fixed" → ticket reopens (newStatus=open|in_progress).
// On either, the server action revalidates the page, so the prompt
// disappears (csatResponse is now set) and the new status pill appears.
//
// Same logic as `/csat/confirm` (the email-link route), without needing
// a signed token — the caller is the authenticated ticket owner.

type Props = {
  ticketId: string;
  /** If non-null, the customer already responded — render the recap
   *  banner instead of the prompt. */
  csatResponse: string | null;
};

export function CustomerCsatPrompt({ ticketId, csatResponse }: Props) {
  const router = useRouter();
  const t = useTranslations("portal.tickets.csat");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startTransition] = useTransition();

  // Already responded — show a small confirmation pill so the customer
  // remembers they've given feedback. Different copy for satisfied vs
  // unsatisfied so the recap reflects what they said.
  if (csatResponse) {
    const isSatisfied = csatResponse === "satisfied";
    return (
      <div
        role="status"
        className="mt-6 rounded-lg border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/40 p-4 flex items-start gap-3"
      >
        <CheckCircle2
          className="size-5 shrink-0 text-green-700 dark:text-green-300 mt-0.5"
          aria-hidden="true"
        />
        <div className="text-sm">
          <p className="font-medium text-green-900 dark:text-green-200">
            {isSatisfied ? t("recapSatisfied") : t("recapUnsatisfied")}
          </p>
          <p className="mt-0.5 text-green-700 dark:text-green-300">
            {t("recapThanks")}
          </p>
        </div>
      </div>
    );
  }

  function submit(response: "satisfied" | "unsatisfied") {
    setError(null);
    startTransition(async () => {
      const result = await submitCsatFromPortal(ticketId, response);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Page revalidates inside the action; just refresh the route to
      // pick up the updated ticket status + csatResponse.
      router.refresh();
    });
  }

  return (
    <div className="mt-6 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/30 p-5">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        {t("title")}
      </h2>
      <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
        {t("subtitle")}
      </p>

      <div className="mt-4 flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={() => submit("satisfied")}
          disabled={submitting}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 min-h-[44px]"
        >
          <ThumbsUp className="size-4" aria-hidden="true" />
          {t("yesButton")}
        </button>
        <button
          type="button"
          onClick={() => submit("unsatisfied")}
          disabled={submitting}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 min-h-[44px]"
        >
          <ThumbsDown className="size-4" aria-hidden="true" />
          {t("noButton")}
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          aria-live="polite"
          className="mt-3 text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      ) : null}

      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        {t("hint")}
      </p>
    </div>
  );
}
