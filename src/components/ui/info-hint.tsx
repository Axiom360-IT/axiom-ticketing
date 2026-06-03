"use client";

import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * A small "ⓘ" affordance that explains what a control/section is for. Hover or
 * focus reveals the `label` in a tooltip. Self-contained (bundles its own
 * Provider) so it can be dropped next to any heading or field.
 */
export function InfoHint({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <TooltipProvider delay={120}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={label}
              className={cn(
                "inline-flex items-center text-zinc-400 transition-colors hover:text-zinc-600 focus:outline-none focus-visible:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300",
                className,
              )}
            >
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
