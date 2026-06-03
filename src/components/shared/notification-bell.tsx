"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Bell } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getRecentNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationListItem,
  type RecentNotificationsResult,
} from "@/app/actions/notifications";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 30_000;

type Props = {
  initial: RecentNotificationsResult;
};

export function NotificationBell({ initial }: Props) {
  const t = useTranslations("notifications.bell");
  const tNotif = useTranslations("notifications");
  const formatter = useFormatter();
  const [data, setData] = useState<RecentNotificationsResult>(initial);
  const [isPending, startTransition] = useTransition();

  // Poll every 30 seconds while the page is open. We stop the timer when
  // the document is hidden so a backgrounded tab doesn't burn round-trips.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function refresh() {
      if (cancelled) return;
      const next = await getRecentNotifications();
      if (!cancelled) setData(next);
    }

    function start() {
      if (timer) return;
      timer = setInterval(refresh, POLL_INTERVAL_MS);
    }
    function stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    function onVisibility() {
      if (document.visibilityState === "visible") {
        void refresh();
        start();
      } else {
        stop();
      }
    }

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  function handleMarkRead(id: string) {
    startTransition(async () => {
      await markNotificationRead(id);
      const next = await getRecentNotifications();
      setData(next);
    });
  }

  function handleMarkAllRead() {
    startTransition(async () => {
      await markAllNotificationsRead();
      const next = await getRecentNotifications();
      setData(next);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative p-2 rounded-md text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        aria-label={t("ariaLabel")}
      >
        <Bell className="w-4 h-4" aria-hidden="true" />
        {data.unreadCount > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-medium leading-none">
            {data.unreadCount > 99 ? "99+" : data.unreadCount}
          </span>
        ) : null}
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {data.unreadCount > 0
            ? t("unreadAriaLive", { count: data.unreadCount })
            : ""}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-xs font-medium text-muted-foreground">
            {t("unreadCount", { count: data.unreadCount })}
          </span>
          {data.unreadCount > 0 ? (
            <button
              type="button"
              onClick={handleMarkAllRead}
              disabled={isPending}
              className="text-xs text-blue-600 hover:underline dark:text-blue-400 disabled:opacity-50"
            >
              {isPending ? t("markAllReadPending") : t("markAllRead")}
            </button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {data.items.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
            {t("empty")}
          </div>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {data.items.map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                onClick={() => handleMarkRead(item.id)}
                renderTitle={(key, args) =>
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  tNotif(key as never, args as any)
                }
                renderBody={(key, args) =>
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  tNotif(key as never, args as any)
                }
                relativeTime={(d) =>
                  formatter.relativeTime(d, { now: new Date() })
                }
              />
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationRow({
  item,
  onClick,
  renderTitle,
  renderBody,
  relativeTime,
}: {
  item: NotificationListItem;
  onClick: () => void;
  renderTitle: (key: string, args: Record<string, string | number> | null) => string;
  renderBody: (key: string, args: Record<string, string | number> | null) => string;
  relativeTime: (d: Date) => string;
}) {
  const title = renderTitle(stripPrefix(item.titleKey), item.titleArgs);
  const body = renderBody(stripPrefix(item.bodyKey), item.bodyArgs);

  const content = (
    <div className="flex items-start justify-between gap-2 w-full">
      <div className="flex-1 min-w-0">
        {/* Full text wraps (no clamp) so the whole notification is readable;
            the title attribute gives a hover tooltip as well. */}
        <p className="font-medium break-words" title={title}>
          {title}
        </p>
        <p
          className="text-xs text-zinc-500 dark:text-zinc-400 break-words"
          title={body}
        >
          {body}
        </p>
      </div>
      <span className="text-[10px] text-zinc-400 shrink-0">
        {relativeTime(item.createdAt)}
      </span>
    </div>
  );

  const cls = cn(
    "block px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors",
    !item.isRead && "bg-blue-50/40 dark:bg-blue-950/20",
  );

  return (
    <li>
      {item.linkUrl ? (
        <Link href={item.linkUrl} className={cls} onClick={onClick}>
          {content}
        </Link>
      ) : (
        <button type="button" className={cn(cls, "w-full text-left")} onClick={onClick}>
          {content}
        </button>
      )}
    </li>
  );
}

// Stored keys are full dotted paths like "notifications.ticket.assigned.title".
// Inside the bell component we already scoped useTranslations to "notifications",
// so strip the prefix before looking up.
function stripPrefix(k: string): string {
  return k.startsWith("notifications.") ? k.slice("notifications.".length) : k;
}
