"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MessageBody } from "@/components/tickets/message-body";
import { AttachmentViewer } from "@/components/tickets/attachment-viewer";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getDownloadUrl } from "@/app/actions/attachments";

export type ThreadAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean;
};

export type ThreadMessage = {
  id: string;
  authorName: string;
  authorEmail: string;
  authorType: "agent" | "customer" | "system";
  body: string;
  bodyFormat: string;
  channel: string;
  isInternalNote: boolean;
  isResolutionNote: boolean;
  createdAt: Date;
  /** True when the author is a recognized ticket participant (a same-org
   *  colleague the requester looped in), not the original requester (req 5.2). */
  isParticipant?: boolean;
  attachments?: ThreadAttachment[];
};

const CHANNEL_KEYS: Record<string, "channelEmail" | "channelPortal" | "channelDashboard" | "channelSystem" | "channelSms"> = {
  email: "channelEmail",
  portal: "channelPortal",
  dashboard: "channelDashboard",
  system: "channelSystem",
  sms: "channelSms",
};

const AUTHOR_KEYS = {
  agent: "authorAgent",
  customer: "authorCustomer",
  system: "authorSystem",
} as const;

export function MessageThread({ messages }: { messages: ThreadMessage[] }) {
  const t = useTranslations("tickets.messages");
  const formatter = useFormatter();

  if (messages.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("empty")}</p>
    );
  }

  return (
    <ol className="space-y-4">
      {messages.map((m) => (
        <li
          key={m.id}
          className={cn(
            "rounded-lg border p-4",
            m.isResolutionNote &&
              "border-green-200 bg-green-50/40 dark:border-green-900 dark:bg-green-950/30",
            m.isInternalNote &&
              "border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/30",
            !m.isInternalNote &&
              !m.isResolutionNote &&
              "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950",
          )}
        >
          <div className="flex items-start gap-3">
            <Avatar className="size-8 shrink-0">
              <AvatarFallback className="text-xs">
                {initials(m.authorName)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{m.authorName}</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t(AUTHOR_KEYS[m.authorType])}
                </span>
                <span className="text-xs text-zinc-400">·</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t(CHANNEL_KEYS[m.channel] ?? "channelDashboard")}
                </span>
                {m.isParticipant ? (
                  <span className="rounded bg-blue-100 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    {t("participantBadge")}
                  </span>
                ) : null}
                {m.isResolutionNote ? (
                  <span className="text-xs font-medium text-green-700 dark:text-green-400">
                    · {t("resolutionNoteBadge")}
                  </span>
                ) : null}
                {m.isInternalNote ? (
                  <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                    · {t("internalNoteBadge")}
                  </span>
                ) : null}
                <span className="ml-auto text-xs text-zinc-400">
                  {formatter.dateTime(m.createdAt, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <MessageBody
                body={m.body}
                bodyFormat={m.bodyFormat}
                className="mt-2"
              />
              {m.attachments && m.attachments.length > 0 ? (
                <AttachmentViewer
                  items={m.attachments}
                  resolveUrl={(id) => getDownloadUrl(id)}
                />
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}


