import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema/organizations";

// ── Monthly-plan burn-down watchlist (req 8.6) ────────────────────────────
//
// The only PROACTIVE commercial-risk surface on the dashboard: monthly-plan
// organizations that are already over their contracted minutes (balance < 0)
// or nearly exhausted (< 20% of included minutes left). Everywhere else the
// team only learns about an overage AFTER the billing monitor emails the
// accountant once the balance has already gone negative — this gives lead time
// to top up, reclassify the work as project billing, or warn the client before
// month close. Exceptions-only and hidden when empty, so it never nags on a
// healthy account.

const PLAN_WATCH_LIMIT = 6;

export type PlanWatchOrg = {
  id: string;
  name: string;
  abbreviation: string;
  includedMinutes: number;
  balanceMinutes: number;
  /** Percent of the plan consumed; exceeds 100 when over-plan. */
  usedPct: number;
  state: "over" | "near";
};

export type PlanWatch = {
  items: PlanWatchOrg[];
};

export async function loadPlanWatch(): Promise<PlanWatch> {
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      abbreviation: organizations.abbreviation,
      includedMinutes: organizations.monthlyMinutesIncluded,
      balanceMinutes: organizations.monthlyMinutesBalance,
    })
    .from(organizations)
    .where(
      and(
        eq(organizations.isMonthlyPlan, true),
        eq(organizations.isActive, true),
        // `> 0` also drops NULL (NULL > 0 is unknown/false), which both avoids
        // divide-by-zero and excludes plans with no contracted minutes set.
        gt(organizations.monthlyMinutesIncluded, 0),
        // Over-plan (balance < 0) OR near-exhausted (< 20% of included left) in
        // one predicate. Integer math on purpose: `balance*5 < included` ⟺
        // `balance < included/5` ⟺ `< 20%`. A float threshold param would infer
        // as `integer` over the Neon HTTP wire and Postgres would reject "0.2";
        // the literal `5` keeps it all-integer. NULL balance is excluded.
        sql`${organizations.monthlyMinutesBalance} * 5 < ${organizations.monthlyMinutesIncluded}`,
      ),
    )
    // Most depleted first: the most-negative balances (deepest over-plan) sort
    // ahead of the merely near-exhausted.
    .orderBy(asc(organizations.monthlyMinutesBalance))
    .limit(PLAN_WATCH_LIMIT);

  return {
    items: rows.map((r) => {
      const included = r.includedMinutes ?? 0;
      const balance = r.balanceMinutes ?? 0;
      const usedPct =
        included > 0 ? Math.round(((included - balance) / included) * 100) : 0;
      return {
        id: r.id,
        name: r.name,
        abbreviation: r.abbreviation,
        includedMinutes: included,
        balanceMinutes: balance,
        usedPct,
        state: balance < 0 ? ("over" as const) : ("near" as const),
      };
    }),
  };
}
