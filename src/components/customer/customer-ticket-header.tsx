"use client";

import { useFormatter, useTranslations } from "next-intl";
import { PriorityBadge, StatusBadge } from "@/components/tickets/badges";
import type { CustomerTicket } from "@/lib/customer/queries";

type Props = {
  ticket: CustomerTicket;
};

export function CustomerTicketHeader({ ticket }: Props) {
  const t = useTranslations("portal.tickets.detail");
  const formatter = useFormatter();
  return (
    <header className="mb-6">
      {/* flex-wrap so the ticket number + two badges don't overflow on
          narrow screens; row gap matches col gap so wrapped badges
          don't kiss the line above. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-2">
        <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
          {ticket.ticketNumber}
        </span>
        <StatusBadge status={ticket.status} />
        <PriorityBadge priority={ticket.priority} />
      </div>
      <h1 className="text-lg sm:text-xl font-semibold text-zinc-900 dark:text-zinc-50 break-words">
        {ticket.subject}
      </h1>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {t("openedAt", {
          when: formatter.relativeTime(ticket.createdAt, { now: new Date() }),
        })}
      </p>
    </header>
  );
}
