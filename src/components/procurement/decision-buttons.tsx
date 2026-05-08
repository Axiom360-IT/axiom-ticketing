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
  approveProcurement,
  markDelivered,
  markPurchased,
  rejectProcurement,
} from "@/app/actions/procurement";

type Props = {
  requestId: string;
  status: string;
  canApprove: boolean;
  canReject: boolean;
  canMarkPurchased: boolean;
  canMarkDelivered: boolean;
};

export function ProcurementDecisionButtons({
  requestId,
  status,
  canApprove,
  canReject,
  canMarkPurchased,
  canMarkDelivered,
}: Props) {
  const router = useRouter();
  const t = useTranslations("procurement.detail");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await action();
        if (!res.ok) {
          setError(res.error ?? t("errorGeneric"));
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("errorGeneric"));
      }
    });
  }

  const isApprovable =
    status === "pending_coordinator_approval" ||
    status === "pending_admin_approval";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canApprove && isApprovable ? (
          <Button
            disabled={isPending}
            onClick={() => run(() => approveProcurement(requestId))}
          >
            {isPending ? t("approving") : t("approve")}
          </Button>
        ) : null}
        {canReject && isApprovable ? (
          <RejectModal
            requestId={requestId}
            onDone={() => router.refresh()}
          />
        ) : null}
        {canMarkPurchased && status === "approved" ? (
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() => run(() => markPurchased(requestId))}
          >
            {isPending ? t("markPurchasing") : t("markPurchased")}
          </Button>
        ) : null}
        {canMarkDelivered && status === "purchased" ? (
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() => run(() => markDelivered(requestId))}
          >
            {isPending ? t("markDelivering") : t("markDelivered")}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function RejectModal({
  requestId,
  onDone,
}: {
  requestId: string;
  onDone: () => void;
}) {
  const t = useTranslations("procurement.detail");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (reason.trim().length < 5) {
      setError(t("rejectReasonPlaceholder"));
      return;
    }
    startTransition(async () => {
      const res = await rejectProcurement(requestId, reason.trim());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      onDone();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="destructive">{t("reject")}</Button>}
      />
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("rejectModalTitle")}</DialogTitle>
            <DialogDescription>
              {t("rejectModalDescription")}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={5}
            placeholder={t("rejectReasonPlaceholder")}
            maxLength={2000}
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
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {tCommon("cancel")}
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={isPending}>
              {isPending ? t("rejecting") : t("reject")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
