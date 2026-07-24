"use client";

import { submitCsatByToken } from "@/app/actions/customer-portal";
import type { CsatRating } from "@/lib/tickets/csat";
import { CsatFeedbackForm } from "./csat-feedback-form";

// Thin client wrapper around the shared emoji form for the hosted (email-link)
// CSAT page. Binds the ticket + access token and delegates to the token action.
export function CsatLandingForm({
  ticketNumber,
  token,
  initialRating,
}: {
  ticketNumber: string;
  token: string;
  initialRating: CsatRating | null;
}) {
  return (
    <CsatFeedbackForm
      initialRating={initialRating}
      submitAction={async (rating: CsatRating, comment: string) => {
        const res = await submitCsatByToken(
          token,
          ticketNumber,
          rating,
          comment || undefined,
        );
        return res.ok ? { ok: true } : { ok: false, error: res.error };
      }}
    />
  );
}
