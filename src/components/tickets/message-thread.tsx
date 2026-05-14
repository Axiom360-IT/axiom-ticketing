"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Download, FileText, Image as ImageIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MessageBody } from "@/components/tickets/message-body";
import { formatBytes, initials } from "@/lib/format";
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
                <AttachmentList items={m.attachments} />
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function AttachmentList({ items }: { items: ThreadAttachment[] }) {
  const images = items.filter((a) => a.isImage);
  const files = items.filter((a) => !a.isImage);

  return (
    <div className="mt-3 space-y-2">
      {images.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {images.map((a) => (
            <AttachmentImage key={a.id} attachment={a} />
          ))}
        </div>
      ) : null}
      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {files.map((a) => (
            <li key={a.id}>
              <AttachmentChip attachment={a} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function AttachmentImage({ attachment }: { attachment: ThreadAttachment }) {
  const t = useTranslations("tickets.attachments");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    startTransition(async () => {
      const res = await getDownloadUrl(attachment.id);
      if (res.ok) {
        setUrl(res.url);
        window.open(res.url, "_blank", "noopener,noreferrer");
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className={cn(
        "group relative w-32 h-32 rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-xs text-zinc-500 hover:border-blue-400 transition-colors",
        isPending && "opacity-60",
      )}
      title={attachment.fileName}
      aria-label={t("openImage", { fileName: attachment.fileName })}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={attachment.fileName}
          className="w-full h-full object-cover"
        />
      ) : (
        <span className="flex flex-col items-center gap-1 px-2 text-center">
          <ImageIcon className="size-5" aria-hidden="true" />
          <span className="truncate w-full">{attachment.fileName}</span>
          {error ? (
            <span className="text-[10px] text-red-500">{error}</span>
          ) : null}
        </span>
      )}
    </button>
  );
}

function AttachmentChip({ attachment }: { attachment: ThreadAttachment }) {
  const t = useTranslations("tickets.attachments");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const res = await getDownloadUrl(attachment.id);
      if (res.ok) {
        window.open(res.url, "_blank", "noopener,noreferrer");
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className={cn(
          "inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-xs",
          "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900",
          isPending && "opacity-60",
        )}
      >
        <FileText className="size-3.5" aria-hidden="true" />
        <span className="font-medium truncate max-w-[16rem]">
          {attachment.fileName}
        </span>
        <span className="text-zinc-400">{formatBytes(attachment.sizeBytes)}</span>
        <Download className="size-3.5" aria-hidden="true" />
        <span className="sr-only">{t("download")}</span>
      </button>
      {error ? (
        <p role="alert" className="text-[10px] text-red-500">
          {error}
        </p>
      ) : null}
    </div>
  );
}

