"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { UserRound } from "lucide-react";
import { PriorityBadge, StatusBadge } from "@/components/tickets/badges";
import type { CustomerTicketSummary } from "@/lib/customer/queries";

type Props = {
  items: CustomerTicketSummary[];
};

// Statuses with customer-facing wording in `portal.tickets.status`; anything
// else (draft/escalation) falls back to the shared admin label.
const CUSTOMER_STATUSES = [
  "open",
  "in_progress",
  "awaiting_customer_confirmation",
  "on_hold",
  "resolved",
  "closed",
];

export function CustomerTicketList({ items }: Props) {
  const t = useTranslations("portal.tickets.list");
  const tStatus = useTranslations("portal.tickets.status");
  const formatter = useFormatter();
  return (
    <ul className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      {items.map((ticket) => (
        <li key={ticket.id}>
          <Link
            href={`/portal/tickets/${ticket.ticketNumber}`}
            className="block px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    {ticket.ticketNumber}
                  </span>
                  <StatusBadge
                    status={ticket.status}
                    label={
                      CUSTOMER_STATUSES.includes(ticket.status)
                        ? tStatus(ticket.status)
                        : undefined
                    }
                  />
                  <PriorityBadge priority={ticket.priority} />
                </div>
                <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50 truncate">
                  {ticket.subject}
                </p>
                {ticket.assignedToName ? (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300 min-w-0">
                    <UserRound
                      className="size-3.5 shrink-0 text-zinc-400 dark:text-zinc-500"
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      {t("assignedTo", { name: ticket.assignedToName })}
                      {ticket.assignedToEmail ? (
                        <span className="text-zinc-400 dark:text-zinc-500">
                          {" · "}
                          {ticket.assignedToEmail}
                        </span>
                      ) : null}
                    </span>
                  </p>
                ) : (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500">
                    <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
                    {t("unassigned")}
                  </p>
                )}
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  {t("lastUpdated", {
                    when: formatter.relativeTime(ticket.updatedAt, {
                      now: new Date(),
                    }),
                  })}
                </p>
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
