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

type Props = {
  ticketId: string;
  /** Coordinator/Super Admin only — gates the "Skip resolution note"
   * checkbox. Server enforces this independently via the
   * `tickets.resolve_skip_note` permission. */
  canSkipNote?: boolean;
};

export function ResolveModal({ ticketId, canSkipNote = false }: Props) {
  const router = useRouter();
  const tModal = useTranslations("tickets.resolveModal");
  const tActions = useTranslations("tickets.actions");
  const tCommon = useTranslations("common");

  const [open, setOpen] = useState(false);
  const [skip, setSkip] = useState(false);
  const [note, setNote] = useState("");
  const [skipReason, setSkipReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const value = skip ? skipReason : note;
  const minError = skip
    ? tModal("skipReasonMinError")
    : tModal("minLengthError");

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (value.trim().length < 10) {
      setError(minError);
      return;
    }
    startTransition(async () => {
      try {
        if (skip) {
          await resolveTicket(ticketId, {
            kind: "skip",
            skipReason: skipReason.trim(),
          });
        } else {
          await resolveTicket(ticketId, {
            kind: "note",
            note: note.trim(),
          });
        }
        setNote("");
        setSkipReason("");
        setSkip(false);
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
            <DialogDescription>
              {skip ? tModal("skipDescription") : tModal("description")}
            </DialogDescription>
          </DialogHeader>

          {canSkipNote ? (
            <div className="flex items-start gap-2 text-sm rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900">
              <input
                id="resolve-skip-checkbox"
                type="checkbox"
                checked={skip}
                onChange={(e) => {
                  setSkip(e.target.checked);
                  setError(null);
                }}
                disabled={isPending}
                className="mt-0.5 size-4 accent-blue-600 cursor-pointer"
              />
              <label
                htmlFor="resolve-skip-checkbox"
                className="cursor-pointer flex-1"
              >
                <span className="font-medium">{tModal("skipCheckbox")}</span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                  {tModal("skipCheckboxHint")}
                </span>
              </label>
            </div>
          ) : null}

          <Textarea
            value={skip ? skipReason : note}
            onChange={(e) =>
              skip ? setSkipReason(e.target.value) : setNote(e.target.value)
            }
            rows={5}
            placeholder={
              skip ? tModal("skipPlaceholder") : tModal("placeholder")
            }
            maxLength={skip ? 500 : 5000}
            disabled={isPending}
            autoFocus
            aria-label={skip ? tModal("skipReasonLabel") : tModal("noteLabel")}
          />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {value.trim().length}/{skip ? 500 : 5000}
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
