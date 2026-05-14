"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

// Debounced URL-driven search input. Replaces the old
// `<form method="get">` pattern that triggered a full page navigation
// on submit. Each keystroke pushes a new URL after a short pause —
// Next.js then re-runs the server component (RSC, not a full reload)
// and the list updates in place.

type Props = {
  /** Search-param name. Defaults to "q". */
  name?: string;
  /** Initial value — read on the server from `searchParams`. */
  initialValue: string;
  placeholder?: string;
  className?: string;
  /** Debounce delay in ms. Defaults to 300. */
  debounceMs?: number;
};

export function UrlSearchInput({
  name = "q",
  initialValue,
  placeholder,
  className,
  debounceMs = 300,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [value, setValue] = useState(initialValue);
  // Tracks the value last committed to the URL — kept in state (not a
  // ref) so we can derive a "dirty" flag during render for the spinner.
  const [lastPushed, setLastPushed] = useState(initialValue);

  // External URL changes (e.g. clearing filters elsewhere) should win
  // over our local state — keep the input in sync if the param shifts
  // out from under us. Compare against `lastPushed` so we don't
  // clobber the user's in-flight typing on the URL change WE caused.
  // The setState-in-effect is intentional here: the URL search params
  // ARE the external system this component synchronizes with.
  useEffect(() => {
    const fromUrl = searchParams.get(name) ?? "";
    if (fromUrl !== lastPushed && fromUrl !== value) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValue(fromUrl);
      setLastPushed(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, name]);

  // Debounce: only push to URL when the user pauses typing.
  useEffect(() => {
    if (value === lastPushed) return;
    const id = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      const trimmed = value.trim();
      if (trimmed) {
        params.set(name, trimmed);
      } else {
        params.delete(name);
      }
      // Filter changes always go back to page 1 — otherwise you can
      // land on an empty page if the search narrows past your offset.
      params.delete("page");
      const qs = params.toString();
      setLastPushed(trimmed);
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname);
      });
    }, debounceMs);
    return () => clearTimeout(id);
  }, [value, lastPushed, name, debounceMs, pathname, router, searchParams]);

  // Show the spinner while the user is typing past the last pushed
  // value (debounce wait) and while React is committing the new RSC
  // payload from the resulting `router.push`.
  const showSpinner = value !== lastPushed || pending;

  return (
    <div className={cn("relative", className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 size-4 text-zinc-400"
      />
      <Input
        type="search"
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="pl-8 pr-8"
      />
      {showSpinner ? (
        <span className="absolute right-2 top-1/2 -translate-y-1/2">
          <Spinner size="sm" />
        </span>
      ) : null}
    </div>
  );
}
