import { eventType } from "inngest";
import { db } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema/notifications";
import { inngest } from "../client";

// Inserts a row into `notifications`. The bell icon's polling Server
// Action reads from this table; render-time i18n uses titleKey/bodyKey
// + args so the user's current locale wins.

type EventData = {
  userId: string;
  eventType: string;
  titleKey: string;
  titleArgs?: Record<string, string | number>;
  bodyKey: string;
  bodyArgs?: Record<string, string | number>;
  linkUrl?: string;
};

export const sendInAppNotification = inngest.createFunction(
  {
    id: "send-in-app-notification",
    retries: 3,
    triggers: eventType("notification/in-app"),
  },
  async ({ event }) => {
    const d = event.data as EventData;
    await db.insert(notifications).values({
      userId: d.userId,
      eventType: d.eventType,
      titleKey: d.titleKey,
      titleArgs: d.titleArgs ?? null,
      bodyKey: d.bodyKey,
      bodyArgs: d.bodyArgs ?? null,
      linkUrl: d.linkUrl ?? null,
    });
    return { ok: true };
  },
);
