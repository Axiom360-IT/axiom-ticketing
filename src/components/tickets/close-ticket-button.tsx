"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { closeTicket } from "@/app/actions/tickets";

export function CloseTicketButton({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const t = useTranslations("tickets.actions");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        await closeTicket(ticketId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("closeError"));
      }
    });
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" disabled={isPending} onClick={handleClick}>
        {isPending ? t("closePending") : t("close")}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
