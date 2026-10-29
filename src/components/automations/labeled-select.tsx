"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// A select that shows what the person READS, never what the engine stores.
//
// Base UI's <Select.Value> prints the raw stored value unless the root is given
// an `items` list to look the label up in. Used bare, the rule builder showed
// `ticket.category_changed` and `flag` in the closed dropdown while showing the
// friendly wording only inside the open list — the worst of both. Every select
// in the builder goes through this so that cannot recur.

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  /** Optional heading to file this option under. Options sharing a group are
   *  shown together; the order of first appearance is kept. */
  group?: string;
};

type Props = {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "default";
  "aria-label"?: string;
};

export function LabeledSelect({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
  size,
  "aria-label": ariaLabel,
}: Props) {
  const grouped = options.some((o) => o.group);
  const groups: { name: string | null; items: SelectOption[] }[] = [];
  if (grouped) {
    for (const o of options) {
      const name = o.group ?? null;
      let g = groups.find((x) => x.name === name);
      if (!g) {
        g = { name, items: [] };
        groups.push(g);
      }
      g.items.push(o);
    }
  }

  const item = (o: SelectOption) => (
    <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
      {o.label}
    </SelectItem>
  );

  return (
    <Select
      value={value}
      disabled={disabled}
      // The lookup that makes <SelectValue> print a label, not the value.
      items={options.map((o) => ({ value: o.value, label: o.label }))}
      onValueChange={(v) => {
        // Base UI can emit null when a selection is cleared; storing it would
        // put a null in a field the engine then fails closed on.
        if (typeof v === "string") onValueChange(v);
      }}
    >
      <SelectTrigger className={className} size={size} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {grouped
          ? groups.map((g) => (
              <SelectGroup key={g.name ?? "_"}>
                {g.name ? <SelectLabel>{g.name}</SelectLabel> : null}
                {g.items.map(item)}
              </SelectGroup>
            ))
          : options.map(item)}
      </SelectContent>
    </Select>
  );
}
