"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

type StatusBadgeProps = {
  status: string;
  className?: string;
};

const STATUS_STYLES: Record<string, string> = {
  open: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900",
  in_progress:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900",
  resolved:
    "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-900",
  closed:
    "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-800",
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const t = useTranslations("tickets.status");
  // Cast: status is validated at the DB-check level (open/in_progress/resolved/closed)
  const label = t(status as "open" | "in_progress" | "resolved" | "closed");
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium",
        STATUS_STYLES[status] ?? STATUS_STYLES.open,
        className,
      )}
    >
      {label}
    </span>
  );
}

type PriorityBadgeProps = {
  priority: string;
  className?: string;
};

const PRIORITY_STYLES: Record<string, string> = {
  low: "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-800",
  medium:
    "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900",
  high: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900",
  critical:
    "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900",
};

export function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  const t = useTranslations("tickets.priority");
  const label = t(priority as "low" | "medium" | "high" | "critical");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium",
        PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.low,
        className,
      )}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{
          backgroundColor:
            priority === "critical"
              ? "#dc2626"
              : priority === "high"
                ? "#d97706"
                : priority === "medium"
                  ? "#2563eb"
                  : "#64748b",
        }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

export function EscalatedBadge({ className }: { className?: string }) {
  const t = useTranslations("tickets");
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium",
        "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900",
        className,
      )}
    >
      {t("escalatedBadge")}
    </span>
  );
}

export function CategoryBadge({
  category,
  className,
}: {
  category: string;
  className?: string;
}) {
  const t = useTranslations("tickets.category");
  const label = t(
    category as "hardware" | "software" | "network" | "access" | "other",
  );
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
        "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
        className,
      )}
    >
      {label}
    </span>
  );
}
