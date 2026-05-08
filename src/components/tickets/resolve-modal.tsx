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
import { resolveTicket } from "@/app/actions/tickets";

export function ResolveModal({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const tModal = useTranslations("tickets.resolveModal");
  const tActions = useTranslations("tickets.actions");
  const tCommon = useTranslations("common");

  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (note.trim().length < 10) {
      setError(tModal("minLengthError"));
      return;
    }
    startTransition(async () => {
      try {
        await resolveTicket(ticketId, note.trim());
        setNote("");
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : tModal("genericError"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="default">{tActions("resolve")}</Button>}
      />
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{tModal("title")}</DialogTitle>
            <DialogDescription>{tModal("description")}</DialogDescription>
          </DialogHeader>

          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={5}
            placeholder={tModal("placeholder")}
            maxLength={5000}
            disabled={isPending}
            autoFocus
          />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {note.trim().length}/5000
          </p>

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
              {isPending ? tActions("resolvePending") : tActions("resolve")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
