"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setTicketType } from "@/app/actions/tickets";

type TypeOption = { value: string; label: string };

/**
 * Staff type picker on the ticket detail — classifies a ticket's "type of work"
 * during triage. Options come from the admin-managed types list; the current
 * value is kept selectable even if it was deactivated.
 */
export function TicketTypeControl({
  ticketId,
  current,
  currentLabel,
  types,
}: {
  ticketId: string;
  current: string;
  currentLabel: string;
  types: TypeOption[];
}) {
  const router = useRouter();
  const [value, setValue] = useState<string>(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const options: TypeOption[] = types.some((t) => t.value === current)
    ? types
    : [{ value: current, label: currentLabel }, ...types];

  function handleChange(next: string) {
    if (!next || next === value) return;
    const prev = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const res = await setTicketType(ticketId, next);
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
        items={Object.fromEntries(options.map((t) => [t.value, t.label]))}
        value={value}
        onValueChange={(v) => v && handleChange(v)}
        disabled={pending}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
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
