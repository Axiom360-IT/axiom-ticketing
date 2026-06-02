"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

// Four single-select stages (Meeting-2, CR-26).
const STATUS_STYLES: Record<string, string> = {
  awaiting_customer_payment:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900",
  order_pending:
    "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-900",
  order_placed:
    "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900",
  order_completed:
    "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-900",
};

type ProcurementStatus =
  | "awaiting_customer_payment"
  | "order_pending"
  | "order_placed"
  | "order_completed";

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
        STATUS_STYLES[status] ?? STATUS_STYLES.awaiting_customer_payment,
        className,
      )}
    >
      {t(status as ProcurementStatus)}
    </span>
  );
}
