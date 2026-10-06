import { and, isNull, lt, sql } from "drizzle-orm";
import { cron } from "inngest";
import { db } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema/notifications";
import { pruneRunHistory, withAutomationRun } from "@/lib/automations/runs";
import { getSetting } from "@/lib/settings";
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
  async ({ step }) =>
    withAutomationRun("cleanup-old-notifications", async () => {
      const on = await getSetting<boolean>("housekeeping.enabled");
      if (on === false) return { skipped: "disabled" as const };

      const cutoff = new Date(Date.now() - NINETY_DAYS_MS);
      const archived = await step.run("archive", async () => {
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
        return updated.length;
      });

      // Run history has the same shape of problem as notifications: the
      // monitors fire every 20 minutes, so this table grows ~2k rows a day.
      // Pruned here rather than in its own cron — it is the same nightly
      // retention decision, and one fewer job to explain.
      const runDays = await getSetting<number>("housekeeping.run_history_days");
      const prunedRuns = await step.run("prune-run-history", async () =>
        pruneRunHistory(
          typeof runDays === "number" && runDays > 0 ? runDays : 30,
        ),
      );

      return { archived, prunedRuns };
    }),
);
