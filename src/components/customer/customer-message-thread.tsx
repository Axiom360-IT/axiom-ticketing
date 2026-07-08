"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MessageBody } from "@/components/tickets/message-body";
import {
  AttachmentViewer,
  type ResolveUrl,
} from "@/components/tickets/attachment-viewer";
import { initials } from "@/lib/format";
import type { CustomerMessage } from "@/lib/customer/queries";
import { cn } from "@/lib/utils";
import { getDownloadUrl, getGuestDownloadUrl } from "@/app/actions/attachments";

type Props = {
  messages: CustomerMessage[];
  /** Guest portal only: the HMAC ticket token + number, so attachment
   *  downloads authenticate by token instead of a session. */
  guestToken?: string;
  ticketNumber?: string;
};

export function CustomerMessageThread({
  messages,
  guestToken,
  ticketNumber,
}: Props) {
  // Guests download by token; signed-in customers by session (a Customer holds
  // tickets.view on their own ticket).
  const resolveUrl: ResolveUrl =
    guestToken && ticketNumber
      ? (id) =>
          getGuestDownloadUrl({
            ticketNumber,
            token: guestToken,
            attachmentId: id,
          })
      : (id) => getDownloadUrl(id);
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
                  <AttachmentViewer
                    items={m.attachments}
                    resolveUrl={resolveUrl}
                  />
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
