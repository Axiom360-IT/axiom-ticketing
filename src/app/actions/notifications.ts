"use server";

import { and, count, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema/notifications";

export type NotificationListItem = {
  id: string;
  eventType: string;
  titleKey: string;
  titleArgs: Record<string, string | number> | null;
  bodyKey: string;
  bodyArgs: Record<string, string | number> | null;
  linkUrl: string | null;
  isRead: boolean;
  createdAt: Date;
};

export type RecentNotificationsResult = {
  unreadCount: number;
  items: NotificationListItem[];
};

const RECENT_LIMIT = 20;

/**
 * Reads the most recent (up to 20) un-archived notifications for the
 * current user, plus the total unread count. Polled every 30s by the
 * bell icon component.
 */
export async function getRecentNotifications(): Promise<RecentNotificationsResult> {
  const user = await requireSessionUser();

  const items = await db
    .select({
      id: notifications.id,
      eventType: notifications.eventType,
      titleKey: notifications.titleKey,
      titleArgs: notifications.titleArgs,
      bodyKey: notifications.bodyKey,
      bodyArgs: notifications.bodyArgs,
      linkUrl: notifications.linkUrl,
      isRead: notifications.isRead,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, user.id),
        isNull(notifications.archivedAt),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(RECENT_LIMIT);

  const [{ value: unreadCount }] = await db
    .select({ value: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, user.id),
        eq(notifications.isRead, false),
        isNull(notifications.archivedAt),
      ),
    );

  return {
    unreadCount: Number(unreadCount),
    items: items.map((i) => ({
      ...i,
      titleArgs: (i.titleArgs as Record<string, string | number> | null) ?? null,
      bodyArgs: (i.bodyArgs as Record<string, string | number> | null) ?? null,
    })),
  };
}

/** Mark a single notification read. */
export async function markNotificationRead(
  notificationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(notificationId)) {
    return { ok: false, error: "Invalid id" };
  }
  const user = await requireSessionUser();
  await db
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, user.id),
      ),
    );
  revalidatePath("/admin");
  return { ok: true };
}

/** Mark every unread notification for the current user read. */
export async function markAllNotificationsRead(): Promise<{
  ok: true;
}> {
  const user = await requireSessionUser();
  await db
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, user.id),
        eq(notifications.isRead, false),
      ),
    );
  revalidatePath("/admin");
  return { ok: true };
}
