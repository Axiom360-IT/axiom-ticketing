"use client";

import { useState } from "react";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  TICKET_TYPE_ICON_KEYS,
  type TicketTypeIconKey,
} from "@/lib/tickets/type-icon-keys";
import {
  TICKET_TYPE_ICON_COMPONENTS,
  resolveTicketTypeIconKey,
} from "@/lib/tickets/type-icons";

// Trigger renders the currently-selected icon; the popover holds every
// curated key as a radio-style grid (same interaction shape as the CSAT
// emoji picker: role="radio" + aria-checked, idle/selected variants).
export function TicketTypeIconPicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (icon: TicketTypeIconKey) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const SelectedIcon = TICKET_TYPE_ICON_COMPONENTS[resolveTicketTypeIconKey(value)];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 transition-colors hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          />
        }
      >
        <SelectedIcon className="size-4" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent className="w-64">
        <div
          role="radiogroup"
          aria-label={label}
          className="grid grid-cols-6 gap-1 p-1"
        >
          {TICKET_TYPE_ICON_KEYS.map((key) => {
            const Icon = TICKET_TYPE_ICON_COMPONENTS[key];
            const selected = key === value;
            return (
              <PopoverClose
                key={key}
                render={
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={key}
                    onClick={() => onChange(key)}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-md border transition-colors",
                      selected
                        ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-600 dark:bg-blue-950/40 dark:text-blue-300"
                        : "border-transparent text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
                    )}
                  />
                }
              >
                <Icon className="size-4" aria-hidden="true" />
              </PopoverClose>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
