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
// On "No, still not fixed" → reveals a textarea so the customer can
// describe what's still broken; on submit the ticket reopens
// (newStatus=open|in_progress) and the comment is posted as a customer
// message on the thread so the assigned tech has context.
//
// Same logic as `/csat/confirm` (the email-link route), without needing
// a signed token — the caller is the authenticated ticket owner.

const COMMENT_MAX = 2000;

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
  const [stage, setStage] = useState<"prompt" | "unsatisfied">("prompt");
  const [comment, setComment] = useState("");

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

  function submitSatisfied() {
    setError(null);
    startTransition(async () => {
      const result = await submitCsatFromPortal(ticketId, "satisfied");
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function submitUnsatisfied() {
    setError(null);
    if (comment.length > COMMENT_MAX) {
      setError(t("commentTooLong"));
      return;
    }
    startTransition(async () => {
      const result = await submitCsatFromPortal(
        ticketId,
        "unsatisfied",
        comment.trim() || undefined,
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (stage === "unsatisfied") {
    return (
      <div className="mt-6 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/30 p-5">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          {t("commentLabel")}
        </h2>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          disabled={submitting}
          rows={4}
          maxLength={COMMENT_MAX}
          placeholder={t("commentPlaceholder")}
          aria-label={t("commentLabel")}
          className="mt-3 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {t("commentHint")}
        </p>

        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={submitUnsatisfied}
            disabled={submitting}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 min-h-[44px]"
          >
            {submitting ? t("submittingUnsatisfied") : t("submitUnsatisfied")}
          </button>
          <button
            type="button"
            onClick={() => {
              setStage("prompt");
              setComment("");
              setError(null);
            }}
            disabled={submitting}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 min-h-[44px]"
          >
            {t("cancel")}
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

      <div className="mt-4 flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={submitSatisfied}
          disabled={submitting}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 min-h-[44px]"
        >
          <ThumbsUp className="size-4" aria-hidden="true" />
          {t("yesButton")}
        </button>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setStage("unsatisfied");
          }}
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
