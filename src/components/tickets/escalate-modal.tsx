"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
  const tModal = useTranslations("tickets.escalateModal");
  const tActions = useTranslations("tickets.actions");
  const tCommon = useTranslations("common");

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleEscalate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (reason.trim().length < 10) {
      setError(tModal("minLengthError"));
      return;
    }
    startTransition(async () => {
      try {
        await escalateTicket(ticketId, reason.trim());
        setReason("");
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : tModal("escalateError"));
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
        setError(err instanceof Error ? err.message : tModal("deescalateError"));
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
        {isPending ? tActions("deescalatePending") : tActions("deescalate")}
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="outline">{tActions("escalate")}</Button>}
      />
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleEscalate} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{tModal("escalateTitle")}</DialogTitle>
            <DialogDescription>
              {tModal("escalateDescription")}
            </DialogDescription>
          </DialogHeader>

          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            placeholder={tModal("reasonPlaceholder")}
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
              {tCommon("cancel")}
            </DialogClose>
            <Button type="submit" disabled={isPending}>
              {isPending ? tActions("escalatePending") : tActions("escalate")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
