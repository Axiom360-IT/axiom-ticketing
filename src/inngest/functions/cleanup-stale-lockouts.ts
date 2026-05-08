import { and, isNotNull, lt } from "drizzle-orm";
import { cron } from "inngest";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { inngest } from "../client";

// Daily at 3:45am UTC. Clears `users.locked_until` rows whose timestamp
// has passed. The Redis-side counter and lock both have TTLs already, so
// in steady state there's nothing to clean — this exists as a safety net
// for the durable mirror in case a row gets stranded (e.g. a partial
// write where Redis reset before we updated the row).

export const cleanupStaleLockouts = inngest.createFunction(
  {
    id: "cleanup-stale-lockouts",
    triggers: cron("45 3 * * *"),
  },
  async ({ step }) => {
    return step.run("clear-expired", async () => {
      const cleared = await db
        .update(users)
        .set({ lockedUntil: null })
        .where(
          and(isNotNull(users.lockedUntil), lt(users.lockedUntil, new Date())),
        )
        .returning({ id: users.id });
      return { cleared: cleared.length };
    });
  },
);
