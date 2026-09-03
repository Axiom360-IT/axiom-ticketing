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
import { setTicketServiceType } from "@/app/actions/tickets";

const SERVICE_TYPES = ["remote", "onsite", "hybrid"] as const;

/**
 * Staff service-type picker on the ticket detail sidebar — onsite / remote /
 * hybrid, set once on the ticket as a whole. Unlike Type/Category this is a
 * fixed 3-value enum, not an admin-managed taxonomy, so the option list is
 * hardcoded rather than loaded from the DB. Work-log entries no longer choose
 * this per entry — each new entry silently snapshots whatever this is set to.
 */
export function TicketServiceTypeControl({
  ticketId,
  current,
}: {
  ticketId: string;
  current: string;
}) {
  const router = useRouter();
  const t = useTranslations("tickets.workLog");
  const [value, setValue] = useState<string>(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const labels: Record<(typeof SERVICE_TYPES)[number], string> = {
    remote: t("serviceRemote"),
    onsite: t("serviceOnsite"),
    hybrid: t("serviceHybrid"),
  };

  function handleChange(next: string) {
    if (!next || next === value) return;
    const prev = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const res = await setTicketServiceType(ticketId, next);
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
        items={labels}
        value={value}
        onValueChange={(v) => v && handleChange(v)}
        disabled={pending}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SERVICE_TYPES.map((v) => (
            <SelectItem key={v} value={v}>
              {labels[v]}
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
