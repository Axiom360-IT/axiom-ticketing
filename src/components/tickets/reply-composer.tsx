"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { addInternalNote, replyToTicket } from "@/app/actions/tickets";
import { cn } from "@/lib/utils";

type ReplyComposerProps = {
  ticketId: string;
  /** Whether the current user holds tickets.internal_note for this ticket. */
  canInternalNote?: boolean;
};

export function ReplyComposer({
  ticketId,
  canInternalNote = false,
}: ReplyComposerProps) {
  const router = useRouter();
  const tReply = useTranslations("tickets.reply");
  const tActions = useTranslations("tickets.actions");

  const [body, setBody] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // If the user loses internal-note permission mid-session (impersonation
  // ends, role change), we still respect the prop on submit.
  const internal = isInternal && canInternalNote;

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const trimmed = body.trim();
    if (trimmed.length === 0) {
      setError(tReply("errorEmpty"));
      return;
    }
    startTransition(async () => {
      try {
        if (internal) {
          await addInternalNote(ticketId, trimmed);
        } else {
          await replyToTicket(ticketId, trimmed);
        }
        setBody("");
        setIsInternal(false);
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : internal
              ? tReply("internalErrorGeneric")
              : tReply("errorGeneric"),
        );
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "space-y-3 rounded-md p-3 transition-colors",
        internal &&
          "bg-amber-50 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-900",
      )}
    >
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        placeholder={
          internal ? tReply("internalPlaceholder") : tReply("placeholder")
        }
        maxLength={10000}
        disabled={isPending}
        className={cn(
          internal &&
            "bg-amber-50/60 dark:bg-amber-950/60 border-amber-300 dark:border-amber-800",
        )}
      />

      {error ? (
        <div
          role="alert"
          className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 dark:bg-red-950/40 dark:border-red-900 dark:text-red-400"
        >
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap text-xs">
          {canInternalNote ? (
            <label className="inline-flex items-center gap-2 cursor-pointer select-none text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={isInternal}
                onChange={(e) => setIsInternal(e.target.checked)}
                className="size-3.5 accent-amber-600"
                disabled={isPending}
              />
              <Lock className="size-3.5" aria-hidden="true" />
              <span>{tReply("internalToggleLabel")}</span>
            </label>
          ) : null}
          <p
            className={cn(
              "text-xs",
              internal
                ? "text-amber-700 dark:text-amber-400 font-medium"
                : "text-zinc-500 dark:text-zinc-400",
            )}
          >
            {internal ? tReply("internalFooterHint") : tReply("footerHint")}
          </p>
        </div>
        <Button type="submit" disabled={isPending || body.trim().length === 0}>
          {isPending
            ? internal
              ? tReply("internalNoteSendingLabel")
              : tActions("replyPending")
            : internal
              ? tReply("internalNoteSendLabel")
              : tActions("reply")}
        </Button>
      </div>
    </form>
  );
}
