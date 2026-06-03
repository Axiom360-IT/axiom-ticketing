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
  const t = useTranslations("tickets.assignControl");

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
        setError(err instanceof Error ? err.message : t("genericError"));
      }
    });
  }

  // base-ui Select needs `items` (value→label) to render the chosen label in
  // the trigger; without it the trigger shows the raw value (the UUID).
  const itemLabels = Object.fromEntries(
    technicians.map((tech) => [tech.id, tech.name]),
  );

  return (
    <div className="space-y-1.5">
      <Select
        items={itemLabels}
        value={value}
        onValueChange={handleChange}
        disabled={isPending}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t("unassigned")} />
        </SelectTrigger>
        <SelectContent>
          {technicians.map((tech) => (
            <SelectItem key={tech.id} value={tech.id}>
              {tech.name}
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
