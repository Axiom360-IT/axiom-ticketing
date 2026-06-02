"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { setProcurementStatus } from "@/app/actions/procurement";

// Four single-select stages (Meeting-2, CR-26). Approval/reject removed (CR-24).
const STAGES = [
  "awaiting_customer_payment",
  "order_pending",
  "order_placed",
  "order_completed",
] as const;
type Stage = (typeof STAGES)[number];

type Props = {
  requestId: string;
  status: string;
  /** Whether the caller can move the request between stages (procurement.manage). */
  canManage: boolean;
};

export function ProcurementDecisionButtons({
  requestId,
  status,
  canManage,
}: Props) {
  const router = useRouter();
  const t = useTranslations("procurement.status");
  const tDetail = useTranslations("procurement.detail");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!canManage) return null;

  function setStage(stage: Stage) {
    if (stage === status) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await setProcurementStatus(requestId, stage);
        if (!res.ok) {
          setError(res.error ?? tDetail("errorGeneric"));
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : tDetail("errorGeneric"));
      }
    });
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {tDetail("stageLabel")}
      </p>
      <div className="flex flex-wrap gap-2" role="group">
        {STAGES.map((s) => (
          <Button
            key={s}
            type="button"
            variant={s === status ? "default" : "outline"}
            disabled={isPending}
            onClick={() => setStage(s)}
          >
            {t(s)}
          </Button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
