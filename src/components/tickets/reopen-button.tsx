"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { reopenTicket } from "@/app/actions/tickets";

export function ReopenButton({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        await reopenTicket(ticketId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to reopen.");
      }
    });
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" disabled={isPending} onClick={handleClick}>
        {isPending ? "Reopening…" : "Reopen ticket"}
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
