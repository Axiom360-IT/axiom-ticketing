// Pure types + helpers for the per-organization work breakdown (reqs 8.4/8.5).
// Lives outside the "use server" actions file (which may only export async
// functions) so both the query (getOrganizationUsage) and the breakdown
// component can share them.
//
// Categories are the ticket `billable` values; an uncategorized ticket (NULL)
// is its own bucket so nothing is hidden.

export const USAGE_CATEGORY_ORDER = [
  "monthly_plan",
  "project",
  "rework",
  "yes",
  "no",
  "uncategorized",
] as const;
export type UsageCategory = (typeof USAGE_CATEGORY_ORDER)[number];

export type UsageBucket = {
  byCategory: Record<UsageCategory, number>;
  total: number;
};

export type OrganizationUsage = {
  currentMonth: { ym: string } & UsageBucket;
  allTime: UsageBucket;
  /** Newest-first, up to the last 6 months that have any logged work. */
  months: Array<{ ym: string } & UsageBucket>;
};

export function emptyBucket(): UsageBucket {
  const byCategory = Object.fromEntries(
    USAGE_CATEGORY_ORDER.map((c) => [c, 0]),
  ) as Record<UsageCategory, number>;
  return { byCategory, total: 0 };
}

export function normalizeCategory(billable: string | null): UsageCategory {
  if (billable && (USAGE_CATEGORY_ORDER as readonly string[]).includes(billable)) {
    return billable as UsageCategory;
  }
  return "uncategorized";
}
