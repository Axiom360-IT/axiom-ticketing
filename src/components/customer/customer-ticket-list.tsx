"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { PriorityBadge, StatusBadge } from "@/components/tickets/badges";
import type { CustomerTicketSummary } from "@/lib/customer/queries";

type Props = {
  items: CustomerTicketSummary[];
};

export function CustomerTicketList({ items }: Props) {
  const t = useTranslations("portal.tickets.list");
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
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    {ticket.ticketNumber}
                  </span>
                  <StatusBadge status={ticket.status} />
                  <PriorityBadge priority={ticket.priority} />
                </div>
                <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50 truncate">
                  {ticket.subject}
                </p>
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
