import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { cron } from "inngest";
import { db } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema/organizations";
import { inngest } from "../client";

// Monthly support-plan reset (req 8.2). Runs DAILY (06:00 UTC) and resets every
// monthly-plan org that hasn't yet been reset this calendar month — so on the
// 1st each plan's "hours remaining" returns to its included allotment (no
// rollover) and the over-plan alert flag is cleared. Idempotent: comparing
// `monthly_plan_reset_at` against the start of the current month means each org
// resets at most once per month no matter how often the cron fires.

export const monthlyPlanReset = inngest.createFunction(
  {
    id: "monthly-plan-reset",
    triggers: cron("0 6 * * *"),
  },
  async ({ step }) => {
    return step.run("reset", async () => {
      const rows = await db
        .update(organizations)
        .set({
          // No rollover: balance goes back to the included allotment.
          monthlyMinutesBalance: sql`${organizations.monthlyMinutesIncluded}`,
          monthlyPlanResetAt: sql`now()`,
          // Fresh month, balance >= 0 again — let a future dip re-alert.
          negativeBalanceAlertedAt: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(organizations.isMonthlyPlan, true),
            isNotNull(organizations.monthlyMinutesIncluded),
            or(
              isNull(organizations.monthlyPlanResetAt),
              // UTC-pinned start of the current month as a timestamptz — a
              // clean instant comparison independent of the session timezone,
              // and works on every Postgres version (the 3-arg date_trunc is
              // Postgres 14+ only).
              lt(
                organizations.monthlyPlanResetAt,
                sql`date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
              ),
            ),
          ),
        )
        .returning({ id: organizations.id });
      return { reset: rows.length };
    });
  },
);
