"use client";

import { useMemo } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

// Searchable multi-select for picking roles. Scales to hundreds of
// options — chips render inline with the search input, the popup is
// virtualized by Base UI's filter, and keyboard nav comes for free.

export type RoleOption = { id: string; name: string };

type Props = {
  roles: RoleOption[];
  /** Currently selected role IDs. */
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** Placeholder when nothing is selected. */
  placeholder?: string;
  /** Empty-state message when the search filters out all roles. */
  emptyMessage?: string;
};

export function RoleMultiSelect({
  roles,
  value,
  onChange,
  disabled = false,
  placeholder = "Search roles…",
  emptyMessage = "No roles match your search.",
}: Props) {
  // Combobox items use { value, label } shape so Base UI's default
  // itemToString helpers pick up labels for filtering and chips.
  const items = useMemo(
    () => roles.map((r) => ({ value: r.id, label: r.name })),
    [roles],
  );

  const selectedItems = useMemo(
    () => items.filter((it) => value.includes(it.value)),
    [items, value],
  );

  return (
    <Combobox.Root
      multiple
      items={items}
      value={selectedItems}
      onValueChange={(next) => onChange(next.map((it) => it.value))}
      disabled={disabled}
    >
      <Combobox.Chips
        className={cn(
          "flex flex-wrap items-center gap-1.5 min-h-9 w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1.5 text-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        {selectedItems.map((it) => (
          <Combobox.Chip
            key={it.value}
            className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-blue-600 text-white text-xs font-medium"
          >
            <span>{it.label}</span>
            <Combobox.ChipRemove
              aria-label={`Remove ${it.label}`}
              className="inline-flex items-center justify-center rounded-full hover:bg-blue-700 size-4"
            >
              <X className="size-3" aria-hidden="true" />
            </Combobox.ChipRemove>
          </Combobox.Chip>
        ))}
        <Combobox.Input
          placeholder={selectedItems.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[6rem] bg-transparent outline-none text-sm placeholder:text-zinc-400"
        />
        <Combobox.Trigger
          aria-label="Open roles"
          className="ml-auto inline-flex items-center justify-center text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          <ChevronDown className="size-4" aria-hidden="true" />
        </Combobox.Trigger>
      </Combobox.Chips>

      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="isolate z-50 outline-none">
          <Combobox.Popup
            className={cn(
              "z-50 max-h-[min(20rem,var(--available-height))] w-(--anchor-width) min-w-48",
              "overflow-y-auto rounded-md bg-white dark:bg-zinc-950 p-1 shadow-md",
              "ring-1 ring-zinc-200 dark:ring-zinc-800",
              "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
            )}
          >
            <Combobox.Empty className="px-2 py-3 text-sm text-zinc-500 dark:text-zinc-400 text-center">
              {emptyMessage}
            </Combobox.Empty>
            <Combobox.List>
              {(item: { value: string; label: string }) => (
                <Combobox.Item
                  key={item.value}
                  value={item}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm cursor-pointer outline-none select-none",
                    "data-highlighted:bg-zinc-100 dark:data-highlighted:bg-zinc-800",
                    "data-[selected]:font-medium",
                  )}
                >
                  <Combobox.ItemIndicator className="inline-flex size-4 items-center justify-center text-blue-600">
                    <Check className="size-4" aria-hidden="true" />
                  </Combobox.ItemIndicator>
                  <span className="flex-1">{item.label}</span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
