"use client";

import { useFormatter, useTranslations } from "next-intl";
import { FileText } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MessageBody } from "@/components/tickets/message-body";
import { formatBytes, initials } from "@/lib/format";
import type { CustomerMessage } from "@/lib/customer/queries";
import { cn } from "@/lib/utils";

type Props = {
  messages: CustomerMessage[];
};

export function CustomerMessageThread({ messages }: Props) {
  const t = useTranslations("portal.tickets.thread");
  const formatter = useFormatter();

  if (messages.length === 0) {
    return null;
  }

  return (
    <ol className="space-y-4">
      {messages.map((m) => {
        const isCustomer = m.authorType === "customer";
        const displayName =
          m.authorType === "customer"
            ? t("you")
            : m.authorType === "system"
              ? t("system")
              : t("agent");
        return (
          <li
            key={m.id}
            className={cn(
              "rounded-lg border p-4",
              isCustomer
                ? "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900"
                : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800",
            )}
          >
            <div className="flex items-start gap-3">
              <Avatar className="size-8 shrink-0">
                <AvatarFallback>
                  {initials(isCustomer ? m.authorName : displayName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {displayName}
                  </span>
                  <time
                    dateTime={m.createdAt.toISOString()}
                    className="text-xs text-zinc-500 dark:text-zinc-400 shrink-0"
                  >
                    {formatter.relativeTime(m.createdAt, { now: new Date() })}
                  </time>
                </div>
                <MessageBody body={m.body} bodyFormat={m.bodyFormat} />
                {m.attachments.length > 0 ? (
                  <ul className="mt-3 space-y-1">
                    {m.attachments.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300"
                      >
                        <FileText className="size-3.5" aria-hidden="true" />
                        <span className="truncate">{a.fileName}</span>
                        <span className="text-zinc-400">
                          {formatBytes(a.sizeBytes)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
