"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { replyToTicket } from "@/app/actions/tickets";

export function ReplyComposer({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const tReply = useTranslations("tickets.reply");
  const tActions = useTranslations("tickets.actions");

  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
        await replyToTicket(ticketId, trimmed);
        setBody("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : tReply("errorGeneric"));
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        placeholder={tReply("placeholder")}
        maxLength={10000}
        disabled={isPending}
      />
      {error ? (
        <div
          role="alert"
          className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 dark:bg-red-950/40 dark:border-red-900 dark:text-red-400"
        >
          {error}
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {tReply("footerHint")}
        </p>
        <Button type="submit" disabled={isPending || body.trim().length === 0}>
          {isPending ? tActions("replyPending") : tActions("reply")}
        </Button>
      </div>
    </form>
  );
}
