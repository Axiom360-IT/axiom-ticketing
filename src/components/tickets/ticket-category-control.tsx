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
import { setTicketCategory } from "@/app/actions/tickets";

type CategoryOption = { value: string; label: string };

/**
 * Staff category picker on the ticket detail — lets a technician classify a
 * ticket during triage (most arrive as the default category). Options come from
 * the admin-managed categories list; the current value is included even if it's
 * been deactivated, so the Select still shows the ticket's real category.
 */
export function TicketCategoryControl({
  ticketId,
  current,
  currentLabel,
  categories,
}: {
  ticketId: string;
  current: string;
  currentLabel: string;
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const [value, setValue] = useState<string>(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Ensure the current value is selectable even if it's now inactive.
  const options: CategoryOption[] = categories.some((c) => c.value === current)
    ? categories
    : [{ value: current, label: currentLabel }, ...categories];

  function handleChange(next: string) {
    if (!next || next === value) return;
    const prev = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const res = await setTicketCategory(ticketId, next);
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
        items={Object.fromEntries(options.map((c) => [c.value, c.label]))}
        value={value}
        onValueChange={(v) => v && handleChange(v)}
        disabled={pending}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((c) => (
            <SelectItem key={c.value} value={c.value}>
              {c.label}
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
