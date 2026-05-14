import Link from "next/link";
import { ACCENT_CLASSES, type AccentKey } from "@/lib/branding/presets";
import { cn } from "@/lib/utils";

// Brand wordmark. Two-part text (name + accent suffix), with the accent
// part colored by the resolved branding preset. Renders nothing if both
// halves are empty — defensive against settings rows that wipe both.
//
// `onDark` mode forces both halves to white, for placement on dark
// gradient panels where the default zinc/accent colors would clash.

type Props = {
  brandName: string;
  brandAccent: string;
  accentColor: AccentKey;
  size?: "sm" | "md" | "lg";
  /** When set, render the wordmark as a link to that href. */
  href?: string;
  /** Force white text — for dark hero panels. */
  onDark?: boolean;
  className?: string;
};

const SIZE = {
  sm: "text-lg",
  md: "text-2xl",
  lg: "text-3xl sm:text-4xl",
} as const;

export function Wordmark({
  brandName,
  brandAccent,
  accentColor,
  size = "md",
  href,
  onDark = false,
  className,
}: Props) {
  if (!brandName && !brandAccent) return null;
  const accent = ACCENT_CLASSES[accentColor];
  const nameClass = onDark ? "text-white" : "text-zinc-900 dark:text-zinc-50";
  const accentClass = onDark ? "text-white/80" : accent.text;
  const inner = (
    <span
      className={cn(
        "inline-flex items-baseline gap-0.5 font-semibold tracking-tight select-none",
        SIZE[size],
        className,
      )}
    >
      {brandName ? <span className={nameClass}>{brandName}</span> : null}
      {brandAccent ? <span className={accentClass}>{brandAccent}</span> : null}
    </span>
  );
  if (!href) return inner;
  return (
    <Link
      href={href}
      className={cn(
        "inline-block focus:outline-none focus-visible:ring-2 rounded-md",
        onDark ? "focus-visible:ring-white/60" : accent.ring,
      )}
    >
      {inner}
    </Link>
  );
}
