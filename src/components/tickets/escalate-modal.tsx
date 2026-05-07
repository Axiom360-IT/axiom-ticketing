"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  deescalateTicket,
  escalateTicket,
} from "@/app/actions/tickets";

type EscalateModalProps = {
  ticketId: string;
  isEscalated: boolean;
  canDeescalate: boolean;
};

export function EscalateModal({
  ticketId,
  isEscalated,
  canDeescalate,
}: EscalateModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleEscalate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (reason.trim().length < 10) {
      setError("Escalation reason must be at least 10 characters.");
      return;
    }
    startTransition(async () => {
      try {
        await escalateTicket(ticketId, reason.trim());
        setReason("");
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to escalate ticket.",
        );
      }
    });
  }

  function handleDeescalate() {
    setError(null);
    startTransition(async () => {
      try {
        await deescalateTicket(ticketId);
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to de-escalate ticket.",
        );
      }
    });
  }

  if (isEscalated) {
    if (!canDeescalate) return null;
    return (
      <Button
        variant="outline"
        onClick={handleDeescalate}
        disabled={isPending}
      >
        {isPending ? "De-escalating…" : "De-escalate"}
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline">Escalate</Button>} />
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleEscalate} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Escalate ticket</DialogTitle>
            <DialogDescription>
              The ticket stays assigned to you. IT Director and Coordinator are
              notified to review.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            placeholder="Why does this need senior review? (minimum 10 characters)"
            maxLength={1000}
            disabled={isPending}
            autoFocus
          />

          {error ? (
            <div
              role="alert"
              className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 dark:bg-red-950/40 dark:border-red-900 dark:text-red-400"
            >
              {error}
            </div>
          ) : null}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Escalating…" : "Escalate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
