"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { reopenTicket } from "@/app/actions/tickets";

export function ReopenButton({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const t = useTranslations("tickets.actions");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        await reopenTicket(ticketId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("reopenError"));
      }
    });
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" disabled={isPending} onClick={handleClick}>
        {isPending ? t("reopenPending") : t("reopen")}
      </Button>
      {error ? (
        <p
          role="alert"
          className="text-xs text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
