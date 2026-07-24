"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Frown, Meh, Smile } from "lucide-react";
import {
  type CsatRating,
  commentRequiredFor,
  ratingClosesTicket,
} from "@/lib/tickets/csat";

const COMMENT_MAX = 2000;

type SubmitResult = { ok: true } | { ok: false; error: string };

type Props = {
  /** Preselected emoji (e.g. the one the customer tapped in the email). */
  initialRating?: CsatRating | null;
  /** Persists the rating + comment. Returns ok / an error message. */
  submitAction: (rating: CsatRating, comment: string) => Promise<SubmitResult>;
  /** Called after a successful submit (e.g. router.refresh in the portal). */
  onSuccess?: () => void;
};

const RATINGS: {
  value: CsatRating;
  Icon: typeof Smile;
  labelKey: string;
  // Tailwind classes are literal strings so the JIT can see them.
  ring: string;
  selected: string;
  idle: string;
}[] = [
  {
    value: "happy",
    Icon: Smile,
    labelKey: "ratingHappyLabel",
    ring: "focus-visible:ring-green-500",
    selected:
      "border-green-500 bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300 dark:border-green-600",
    idle: "border-zinc-200 text-zinc-400 hover:border-green-400 hover:text-green-600 dark:border-zinc-700",
  },
  {
    value: "neutral",
    Icon: Meh,
    labelKey: "ratingNeutralLabel",
    ring: "focus-visible:ring-amber-500",
    selected:
      "border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-600",
    idle: "border-zinc-200 text-zinc-400 hover:border-amber-400 hover:text-amber-600 dark:border-zinc-700",
  },
  {
    value: "unhappy",
    Icon: Frown,
    labelKey: "ratingUnhappyLabel",
    ring: "focus-visible:ring-red-500",
    selected:
      "border-red-500 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 dark:border-red-600",
    idle: "border-zinc-200 text-zinc-400 hover:border-red-400 hover:text-red-600 dark:border-zinc-700",
  },
];

export function CsatFeedbackForm({
  initialRating = null,
  submitAction,
  onSuccess,
}: Props) {
  const t = useTranslations("portal.tickets.csat");
  const [rating, setRating] = useState<CsatRating | null>(initialRating);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startTransition] = useTransition();
  const [done, setDone] = useState<CsatRating | null>(null);

  if (done) {
    const recapKey =
      done === "happy"
        ? "recapHappy"
        : done === "neutral"
          ? "recapNeutral"
          : "recapUnhappy";
    return (
      <div
        role="status"
        className="rounded-lg border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/40 p-4 flex items-start gap-3"
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

  const required = rating ? commentRequiredFor(rating) : false;
  const commentTrimmed = comment.trim();
  const canSubmit =
    rating !== null &&
    !submitting &&
    comment.length <= COMMENT_MAX &&
    (!required || commentTrimmed.length > 0);

  function handleSubmit() {
    if (rating === null) return;
    setError(null);
    if (comment.length > COMMENT_MAX) {
      setError(t("commentTooLong"));
      return;
    }
    if (commentRequiredFor(rating) && commentTrimmed.length === 0) {
      setError(t("commentRequiredHint"));
      return;
    }
    const chosen = rating;
    startTransition(async () => {
      const result = await submitAction(chosen, commentTrimmed);
      if (!result.ok) {
        setError(result.error || t("errorGeneric"));
        return;
      }
      setDone(chosen);
      onSuccess?.();
    });
  }

  return (
    <div>
      <div
        role="radiogroup"
        aria-label={t("title")}
        className="flex justify-center gap-3 sm:gap-4"
      >
        {RATINGS.map(({ value, Icon, labelKey, ring, selected, idle }) => {
          const isSelected = rating === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={t(labelKey)}
              disabled={submitting}
              onClick={() => {
                setRating(value);
                setError(null);
              }}
              className={`flex flex-1 max-w-[7rem] flex-col items-center gap-2 rounded-xl border-2 px-3 py-4 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 ${ring} ${
                isSelected ? selected : idle
              }`}
            >
              <Icon className="size-9 sm:size-10" aria-hidden="true" />
              <span
                className={`text-xs font-medium ${
                  isSelected
                    ? ""
                    : "text-zinc-600 dark:text-zinc-300"
                }`}
              >
                {t(labelKey)}
              </span>
            </button>
          );
        })}
      </div>

      {rating ? (
        <div className="mt-5">
          <label
            htmlFor="csat-comment"
            className="block text-sm font-medium text-zinc-900 dark:text-zinc-50"
          >
            {required ? t("commentRequiredLabel") : t("commentOptionalLabel")}
          </label>
          <textarea
            id="csat-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={submitting}
            rows={4}
            maxLength={COMMENT_MAX}
            placeholder={t("commentPlaceholder")}
            className="mt-2 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {required ? t("commentRequiredHint") : t("commentOptionalHint")}
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {ratingClosesTicket(rating) ? t("closesNote") : t("reopensNote")}
          </p>

          <div className="mt-4">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 min-h-[44px]"
            >
              {submitting ? t("submitting") : t("submit")}
            </button>
          </div>
        </div>
      ) : null}

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
