"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mergeTickets } from "@/app/actions/tickets";

type Props = {
  ticketId: string;
  sourceTicketNumber: string;
};

export function MergeModal({ ticketId, sourceTicketNumber }: Props) {
  const router = useRouter();
  const t = useTranslations("tickets.actions");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const res = await mergeTickets(ticketId, target);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      // Refresh in place — the source ticket page will now show the
      // merged banner and the target ticket has the new messages.
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setError(null);
          setTarget("");
          setOpen(true);
        }}
      >
        {t("merge")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("mergeTitle", { source: sourceTicketNumber })}
            </DialogTitle>
            <DialogDescription>
              {t("mergeDescription", { source: sourceTicketNumber })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="merge-target">{t("mergeTargetLabel")}</Label>
            <Input
              id="merge-target"
              autoFocus
              value={target}
              onChange={(e) => setTarget(e.target.value.toUpperCase())}
              placeholder="AX-0042"
              disabled={pending}
              maxLength={32}
            />
            {error ? (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleSubmit}
              disabled={pending || target.trim().length === 0}
            >
              {pending ? t("mergePending") : t("mergeConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
