"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  pending_coordinator_approval:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900",
  pending_admin_approval:
    "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-900",
  approved:
    "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900",
  purchased:
    "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-900",
  delivered:
    "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-900",
  rejected:
    "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900",
};

type ProcurementStatus =
  | "pending_coordinator_approval"
  | "pending_admin_approval"
  | "approved"
  | "rejected"
  | "purchased"
  | "delivered";

export function ProcurementStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const t = useTranslations("procurement.status");
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium",
        STATUS_STYLES[status] ?? STATUS_STYLES.pending_coordinator_approval,
        className,
      )}
    >
      {t(status as ProcurementStatus)}
    </span>
  );
}
