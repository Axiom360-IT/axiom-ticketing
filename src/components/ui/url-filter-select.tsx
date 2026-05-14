"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

// Single-value URL-driven select filter. Replaces the broken pattern of
// embedding a shadcn `<Select>` inside an HTML `<form method="get">` —
// shadcn Select isn't a native form control and doesn't serialize via
// the form's submit. Reading and writing the URL directly with
// `router.push` keeps state shareable and bookmarkable.
//
// Empty value (== "any") removes the param from the URL so the
// canonical "no filter" form has no query string at all.

type Props = {
  /** URL search-param name. */
  name: string;
  /** Visible label rendered above the trigger. */
  label: string;
  /** Current value (read on the server from searchParams). */
  value: string;
  /** Selectable options (excluding the "any" sentinel). */
  options: { value: string; label: string }[];
  /** Label for the "no filter" option. Defaults to "Any". */
  anyLabel?: string;
  /** Pass `false` to render without the "any" option (forces selection). */
  showAny?: boolean;
  /** Width class for the trigger; defaults to a sensible auto width. */
  triggerClassName?: string;
};

export function UrlFilterSelect({
  name,
  label,
  value,
  options,
  anyLabel = "Any",
  showAny = true,
  triggerClassName,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function pushValue(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (!next) {
      params.delete(name);
    } else {
      params.set(name, next);
    }
    // Any filter change moves you back to page 1 — otherwise you can
    // land on an empty page if your filter narrowed below the offset.
    params.delete("page");
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs text-zinc-500 dark:text-zinc-400 inline-flex items-center gap-1.5">
        {label}
        {pending ? <Spinner size="sm" label={`Updating ${label}`} /> : null}
      </label>
      <Select
        // SelectItem disallows empty value="" — use a distinct sentinel
        // for the "any" choice and translate at the boundary.
        value={value ? value : "__any__"}
        onValueChange={(v) => pushValue(v === "__any__" ? "" : (v ?? ""))}
        disabled={pending}
      >
        <SelectTrigger
          className={cn("h-9 min-w-[10rem]", triggerClassName)}
          aria-label={label}
        >
          {/* Base UI's SelectValue does NOT auto-mirror SelectItem text —
              it renders the raw value unless a children-as-function maps
              value → label. Without this map, the trigger would show the
              literal "__any__" sentinel. */}
          <SelectValue placeholder={showAny ? anyLabel : undefined}>
            {(v: string | null) => {
              if (v === "__any__" || !v) return showAny ? anyLabel : "";
              return options.find((o) => o.value === v)?.label ?? v;
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {showAny ? (
            <SelectItem value="__any__">{anyLabel}</SelectItem>
          ) : null}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
