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
import { assignTicket } from "@/app/actions/tickets";

export type Technician = {
  id: string;
  name: string;
  email: string;
};

type AssignControlProps = {
  ticketId: string;
  currentAssigneeId: string | null;
  technicians: Technician[];
};

export function AssignControl({
  ticketId,
  currentAssigneeId,
  technicians,
}: AssignControlProps) {
  const router = useRouter();
  const [value, setValue] = useState<string>(currentAssigneeId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(next: string | null) {
    if (!next || next === value) return;
    const previous = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      try {
        await assignTicket(ticketId, next);
        router.refresh();
      } catch (err) {
        setValue(previous);
        setError(err instanceof Error ? err.message : "Failed to assign.");
      }
    });
  }

  return (
    <div className="space-y-1.5">
      <Select value={value} onValueChange={handleChange} disabled={isPending}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Unassigned" />
        </SelectTrigger>
        <SelectContent>
          {technicians.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.name}
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
