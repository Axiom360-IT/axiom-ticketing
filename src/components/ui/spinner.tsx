import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Minimal spinner. Use inline next to a control (search input,
// filter dropdown) to signal an in-flight request, or alone as a
// standalone loading affordance. For full-page loading, prefer a
// `loading.tsx` skeleton.

type Props = {
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Accessible label. Defaults to a generic "Loading". */
  label?: string;
};

const SIZE_CLASS = {
  sm: "size-3.5",
  md: "size-4",
  lg: "size-5",
} as const;

export function Spinner({ size = "md", className, label = "Loading" }: Props) {
  return (
    <Loader2
      role="status"
      aria-label={label}
      className={cn(
        "animate-spin text-zinc-500 dark:text-zinc-400",
        SIZE_CLASS[size],
        className,
      )}
    />
  );
}
