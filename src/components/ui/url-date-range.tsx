"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// URL-driven "from"/"to" date range. Each pick pushes a new URL (preserving
// every other filter, resetting paging) so the server component re-runs and the
// list/report scopes to the period — the same pattern as UrlSearchInput.

type Props = {
  fromValue: string;
  toValue: string;
  fromLabel: string;
  toLabel: string;
  fromName?: string;
  toName?: string;
  className?: string;
};

export function UrlDateRange({
  fromValue,
  toValue,
  fromLabel,
  toLabel,
  fromName = "from",
  toName = "to",
  className,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // Picking "from" then "to" fires two independent pushes. If both land within
  // one render frame (before the router commits and re-renders), each reading
  // `searchParams` would start from the same stale snapshot and the second push
  // would drop the first. Accumulate into a ref — resynced to every committed
  // navigation — so rapid successive picks compose instead of clobbering.
  const liveParamsRef = useRef(new URLSearchParams(searchParams.toString()));
  useEffect(() => {
    liveParamsRef.current = new URLSearchParams(searchParams.toString());
  }, [searchParams]);

  const push = (name: string, value: string) => {
    const params = new URLSearchParams(liveParamsRef.current.toString());
    if (value) params.set(name, value);
    else params.delete(name);
    params.delete("page");
    liveParamsRef.current = params;
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  };

  return (
    <div className={cn("flex flex-wrap items-end gap-2", className)}>
      <label className="flex flex-col gap-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        <span>{fromLabel}</span>
        <Input
          type="date"
          value={fromValue}
          max={toValue || undefined}
          onChange={(e) => push(fromName, e.target.value)}
          className="h-8 w-40"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        <span>{toLabel}</span>
        <Input
          type="date"
          value={toValue}
          min={fromValue || undefined}
          onChange={(e) => push(toName, e.target.value)}
          className="h-8 w-40"
        />
      </label>
    </div>
  );
}
