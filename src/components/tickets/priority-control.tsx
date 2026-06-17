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
import { setTicketPriority } from "@/app/actions/tickets";

const PRIORITIES = ["low", "medium", "high", "critical"] as const;
type Priority = (typeof PRIORITIES)[number];

export function PriorityControl({
  ticketId,
  current,
}: {
  ticketId: string;
  current: string;
}) {
  const router = useRouter();
  const t = useTranslations("tickets.priority");
  const tCtl = useTranslations("tickets.priorityControl");
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleChange(next: string) {
    if (!next || next === value) return;
    setError(null);
    const prev = value;
    setValue(next);
    startTransition(async () => {
      const res = await setTicketPriority(ticketId, next as Priority);
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
        items={Object.fromEntries(PRIORITIES.map((p) => [p, t(p)]))}
        value={value}
        onValueChange={(v) => handleChange(v ?? "")}
        disabled={pending}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRIORITIES.map((p) => (
            <SelectItem key={p} value={p}>
              {t(p)}
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
