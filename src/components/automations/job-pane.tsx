"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

// The side pane for one automation.
//
// Its OPEN state lives in the URL (`?job=<id>`), not in React state: the server
// page decides whether to render it and loads the history for it. That makes a
// pane linkable ("look at this one"), survives a refresh, and means the history
// is fetched only for the automation someone actually opened — rather than a
// global history loaded for everything and shown at the bottom of a long page.
//
// This wrapper only supplies the slide-over chrome and turns "dismissed" into a
// navigation to `closeHref` (the same URL without `job`).

export function JobPane({
  title,
  subtitle,
  closeHref,
  children,
}: {
  title: string;
  subtitle?: string;
  closeHref: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) router.push(closeHref, { scroll: false });
      }}
    >
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {subtitle ? <SheetDescription>{subtitle}</SheetDescription> : null}
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
