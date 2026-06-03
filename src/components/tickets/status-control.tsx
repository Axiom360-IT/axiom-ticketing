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
import { setTicketStatus } from "@/app/actions/tickets";

// The in-flight statuses a technician can move a ticket between
// (Meeting-2, CR-13). Resolve/reopen keep their dedicated controls.
const WORKING_STATUSES = [
  "open",
  "in_progress",
  "awaiting_customer_confirmation",
] as const;
type WorkingStatus = (typeof WORKING_STATUSES)[number];

export function StatusControl({
  ticketId,
  current,
}: {
  ticketId: string;
  current: string;
}) {
  const router = useRouter();
  const t = useTranslations("tickets.status");
  const tCtl = useTranslations("tickets.statusControl");
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleChange(next: string) {
    if (!next || next === value) return;
    setError(null);
    const prev = value;
    setValue(next);
    startTransition(async () => {
      const res = await setTicketStatus(ticketId, next as WorkingStatus);
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
      <span className="block text-xs text-zinc-600 dark:text-zinc-400">
        {tCtl("label")}
      </span>
      <Select
        items={Object.fromEntries(WORKING_STATUSES.map((s) => [s, t(s)]))}
        value={value}
        onValueChange={(v) => handleChange(v ?? "")}
        disabled={pending}
      >
        <SelectTrigger className="w-60">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WORKING_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {t(s)}
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
