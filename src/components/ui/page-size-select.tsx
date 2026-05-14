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
import { PAGE_SIZE_OPTIONS } from "./pagination";

// Rows-per-page selector. Lives in its own client file so the parent
// `<Pagination>` can stay a server component (its prev/next links work
// without any JS). On change, pushes the new size to `?pageSize=` and
// resets `?page=1` so the user lands on a valid page.

type Props = {
  currentSize: number;
  label: string;
};

export function PageSizeSelect({ currentSize, label }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function pushSize(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("pageSize", next);
    // Reset to page 1 — current offset may now be past the end.
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
        {label}
      </span>
      <Select
        value={String(currentSize)}
        onValueChange={(v) => v && pushSize(v)}
        disabled={pending}
      >
        <SelectTrigger className="h-8 w-[70px]" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAGE_SIZE_OPTIONS.map((size) => (
            <SelectItem key={size} value={String(size)}>
              {size}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
