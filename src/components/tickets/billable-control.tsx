"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setTicketBillable } from "@/app/actions/tickets";

const BILLABLE_VALUES = [
  "yes",
  "no",
  "monthly_plan",
  "project",
  "rework",
] as const;
type BillableValue = (typeof BILLABLE_VALUES)[number];

// Non-empty sentinel for "not categorised yet" (the Select needs a value).
const UNSET = "__unset__";

export function BillableControl({
  ticketId,
  current,
}: {
  ticketId: string;
  current: string | null;
}) {
  const router = useRouter();
  const t = useTranslations("tickets.billable");
  const [value, setValue] = useState<string>(current ?? UNSET);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleChange(next: string) {
    if (!next || next === value) return;
    const prev = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const res = await setTicketBillable(
        ticketId,
        next === UNSET ? null : (next as BillableValue),
      );
      if (!res.ok) {
        setError(res.error);
        setValue(prev);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <Select
        value={value}
        onValueChange={(v) => handleChange(v ?? UNSET)}
        disabled={pending}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNSET}>{t("unset")}</SelectItem>
          {BILLABLE_VALUES.map((v) => (
            <SelectItem key={v} value={v}>
              {t(v)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
