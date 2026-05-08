import { and, isNull, lt, sql } from "drizzle-orm";
import { cron } from "inngest";
import { db } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema/notifications";
import { inngest } from "../client";

// Daily at 3:30am UTC. Sets archived_at on notifications older than 90
// days that haven't already been archived. The bell-icon query already
// filters by archivedAt IS NULL, so archiving is enough — we don't
// hard-delete here. (Hard delete after 1 year is M21 retention.)

const NINETY_DAYS_MS = 90 * 24 * 60 * 60_000;

export const cleanupOldNotifications = inngest.createFunction(
  {
    id: "cleanup-old-notifications",
    triggers: cron("30 3 * * *"),
  },
  async ({ step }) => {
    const cutoff = new Date(Date.now() - NINETY_DAYS_MS);
    return step.run("archive", async () => {
      const updated = await db
        .update(notifications)
        .set({ archivedAt: sql`now()` })
        .where(
          and(
            lt(notifications.createdAt, cutoff),
            isNull(notifications.archivedAt),
          ),
        )
        .returning({ id: notifications.id });
      return { archived: updated.length };
    });
  },
);
