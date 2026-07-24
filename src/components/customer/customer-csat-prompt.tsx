"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { submitCsatFromPortal } from "@/app/actions/customer-portal";
import type { CsatRating } from "@/lib/tickets/csat";
import { CsatFeedbackForm } from "./csat-feedback-form";

// Inline CSAT prompt on the customer ticket detail page. Shown when the ticket
// is `resolved` and hasn't been rated yet. The customer picks one of three
// emoji — happy / neutral (both close the ticket) / unhappy (reopens it, with a
// mandatory comment). The rating + comment are recorded and attributed to the
// ticket's technician (see `ticket_reviews`).
//
// Same shared logic as the `/csat` email-link page — `submitCsatFromPortal`
// delegates to `recordCsatResponse`, so no signed token is needed here (the
// caller is the authenticated ticket owner).

type Props = {
  ticketId: string;
  /** The latest 3-point rating (happy | neutral | unhappy), or null when the
   *  customer hasn't responded yet. Legacy tickets are backfilled to
   *  happy/unhappy from the old binary response. */
  csatRating: string | null;
};

export function CustomerCsatPrompt({ ticketId, csatRating }: Props) {
  const router = useRouter();
  const t = useTranslations("portal.tickets.csat");

  // Already responded — show a small confirmation pill so the customer
  // remembers they've given feedback.
  if (csatRating) {
    const recapKey =
      csatRating === "unhappy"
        ? "recapUnhappy"
        : csatRating === "neutral"
          ? "recapNeutral"
          : "recapHappy";
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
            {t(recapKey)}
          </p>
          <p className="mt-0.5 text-green-700 dark:text-green-300">
            {t("recapThanks")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/30 p-5">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        {t("title")}
      </h2>
      <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
        {t("subtitle")}
      </p>

      <div className="mt-4">
        <CsatFeedbackForm
          submitAction={async (rating: CsatRating, comment: string) => {
            const res = await submitCsatFromPortal(
              ticketId,
              rating,
              comment || undefined,
            );
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onSuccess={() => router.refresh()}
        />
      </div>

      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        {t("hint")}
      </p>
    </div>
  );
}
