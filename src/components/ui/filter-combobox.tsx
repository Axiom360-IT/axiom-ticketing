"use client";

import { useMemo } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Compact, SEARCHABLE filter dropdowns built on Base UI's Combobox.
//
// Both variants render a small trigger button (matching the other list
// filters) that opens a popup with a search box on top and a filtered,
// keyboard-navigable option list — so long lists (customers, technicians)
// stay usable. `FilterMultiCombobox` selects several (count badge on the
// trigger); `FilterCombobox` selects one (the trigger shows the choice).

export type ComboOption = { value: string; label: string };

const POPUP_CLASS = cn(
  "z-50 max-h-[min(22rem,var(--available-height))] w-(--anchor-width) min-w-56",
  "overflow-hidden rounded-md bg-white p-0 shadow-md ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800",
  "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
);
const ITEM_CLASS = cn(
  "flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer outline-none select-none",
  "data-highlighted:bg-zinc-100 dark:data-highlighted:bg-zinc-800",
  "data-[selected]:font-medium",
);

function SearchBox({ placeholder }: { placeholder: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-zinc-200 px-2.5 dark:border-zinc-800">
      <Search
        className="size-4 shrink-0 text-zinc-400"
        aria-hidden="true"
      />
      <Combobox.Input
        placeholder={placeholder}
        className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-zinc-400"
      />
    </div>
  );
}

function OptionList({ emptyMessage }: { emptyMessage: string }) {
  return (
    <div className="max-h-72 overflow-y-auto p-1">
      <Combobox.Empty className="px-2 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {emptyMessage}
      </Combobox.Empty>
      <Combobox.List>
        {(item: ComboOption) => (
          <Combobox.Item key={item.value} value={item} className={ITEM_CLASS}>
            <Combobox.ItemIndicator className="inline-flex size-4 items-center justify-center text-blue-600">
              <Check className="size-4" aria-hidden="true" />
            </Combobox.ItemIndicator>
            <span className="flex-1 truncate">{item.label}</span>
          </Combobox.Item>
        )}
      </Combobox.List>
    </div>
  );
}

export function FilterMultiCombobox({
  label,
  value,
  options,
  onChange,
  disabled,
  searchPlaceholder = "Search…",
  emptyMessage = "No matches.",
}: {
  label: string;
  value: string[];
  options: ComboOption[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  searchPlaceholder?: string;
  emptyMessage?: string;
}) {
  const selected = useMemo(
    () => options.filter((o) => value.includes(o.value)),
    [options, value],
  );
  return (
    <Combobox.Root
      multiple
      items={options}
      value={selected}
      onValueChange={(next) => onChange(next.map((it) => it.value))}
      disabled={disabled}
    >
      <Combobox.Trigger
        disabled={disabled}
        render={
          <Button variant="outline" size="sm" disabled={disabled}>
            <span>{label}</span>
            {value.length > 0 ? (
              <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-100 px-1.5 text-[10px] text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                {value.length}
              </span>
            ) : null}
            <ChevronDown className="ml-0.5 size-3.5" aria-hidden="true" />
          </Button>
        }
      />
      <Combobox.Portal>
        <Combobox.Positioner
          sideOffset={4}
          align="start"
          className="isolate z-50 outline-none"
        >
          <Combobox.Popup className={POPUP_CLASS}>
            <SearchBox placeholder={searchPlaceholder} />
            <OptionList emptyMessage={emptyMessage} />
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

export function FilterCombobox({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  searchPlaceholder = "Search…",
  emptyMessage = "No matches.",
}: {
  /** Current value; "" selects the leading "any" option. */
  value: string;
  /** First option should be the "any / all" reset (value ""). */
  options: ComboOption[];
  onChange: (next: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
}) {
  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? options[0] ?? null,
    [options, value],
  );
  return (
    <Combobox.Root
      items={options}
      value={selected}
      onValueChange={(next) => onChange(next?.value ?? "")}
      disabled={disabled}
    >
      <Combobox.Trigger
        disabled={disabled}
        aria-label={ariaLabel}
        render={
          <Button variant="outline" size="sm" disabled={disabled}>
            <span
              className={cn(
                "max-w-[12rem] truncate",
                value ? "" : "text-zinc-500 dark:text-zinc-400",
              )}
            >
              {selected?.label ?? ariaLabel}
            </span>
            <ChevronDown className="ml-0.5 size-3.5" aria-hidden="true" />
          </Button>
        }
      />
      <Combobox.Portal>
        <Combobox.Positioner
          sideOffset={4}
          align="start"
          className="isolate z-50 outline-none"
        >
          <Combobox.Popup className={POPUP_CLASS}>
            <SearchBox placeholder={searchPlaceholder} />
            <OptionList emptyMessage={emptyMessage} />
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
