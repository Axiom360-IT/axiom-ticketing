import { getTranslations } from "next-intl/server";
import {
  type OrganizationUsage,
  USAGE_CATEGORY_ORDER,
  type UsageCategory,
} from "@/lib/billing/usage";

// Per-organization, per-category work breakdown (reqs 8.4/8.5). Every work
// category is shown — Monthly Support, Project-Basis, Rework, Billable,
// Non-Billable, and an Uncategorized catch-all — for the current month, all
// time, and a short monthly history, so it's easy to read how much work was
// done for an organization and how it splits across categories.

const CATEGORY_STYLE: Record<UsageCategory, { bar: string; dot: string }> = {
  monthly_plan: { bar: "bg-blue-500", dot: "bg-blue-500" },
  project: { bar: "bg-violet-500", dot: "bg-violet-500" },
  rework: { bar: "bg-amber-500", dot: "bg-amber-500" },
  yes: { bar: "bg-emerald-500", dot: "bg-emerald-500" },
  no: { bar: "bg-zinc-400", dot: "bg-zinc-400" },
  uncategorized: { bar: "bg-zinc-300 dark:bg-zinc-600", dot: "bg-zinc-300 dark:bg-zinc-600" },
};

function hoursLabel(minutes: number): string {
  const h = minutes / 60;
  const s = Number.isInteger(h) ? String(h) : h.toFixed(1);
  return `${s}h`;
}

function monthLabel(ym: string): string {
  // ym is "YYYY-MM" (UTC). Render as e.g. "Jun 2026" with a fixed UTC anchor.
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, 1)).toLocaleDateString("en", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export async function OrgUsageBreakdown({ usage }: { usage: OrganizationUsage }) {
  const t = await getTranslations("organizations.usage");
  const catLabel = (c: UsageCategory) => t(`categories.${c}` as `categories.${UsageCategory}`);

  return (
    <div className="space-y-6">
      {/* Current month — bars per category */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t("thisMonth", { month: monthLabel(usage.currentMonth.ym) })}
          </h3>
          <span className="text-sm font-semibold tabular-nums">
            {t("totalHours", { hours: hoursLabel(usage.currentMonth.total) })}
          </span>
        </div>
        {usage.currentMonth.total === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("noneThisMonth")}</p>
        ) : (
          <ul className="space-y-2">
            {USAGE_CATEGORY_ORDER.filter(
              (c) => usage.currentMonth.byCategory[c] > 0,
            ).map((c) => {
              const mins = usage.currentMonth.byCategory[c];
              const pct = Math.round((mins / usage.currentMonth.total) * 100);
              return (
                <li key={c} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-600 dark:text-zinc-300">
                      {catLabel(c)}
                    </span>
                    <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
                      {hoursLabel(mins)} · {pct}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className={`h-full rounded-full ${CATEGORY_STYLE[c].bar}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* All-time totals + monthly history table */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t("history")}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="py-2 pr-3 font-medium">{t("month")}</th>
                {USAGE_CATEGORY_ORDER.map((c) => (
                  <th key={c} className="px-2 py-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      <span className={`inline-block size-2 rounded-full ${CATEGORY_STYLE[c].dot}`} />
                      {catLabel(c)}
                    </span>
                  </th>
                ))}
                <th className="py-2 pl-2 text-right font-medium">{t("total")}</th>
              </tr>
            </thead>
            <tbody>
              {usage.months.length === 0 ? (
                <tr>
                  <td
                    colSpan={USAGE_CATEGORY_ORDER.length + 2}
                    className="py-6 text-center text-zinc-500 dark:text-zinc-400"
                  >
                    {t("noWork")}
                  </td>
                </tr>
              ) : (
                usage.months.map((m) => (
                  <tr
                    key={m.ym}
                    className="border-b border-zinc-100 dark:border-zinc-800/60"
                  >
                    <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-300">
                      {monthLabel(m.ym)}
                    </td>
                    {USAGE_CATEGORY_ORDER.map((c) => (
                      <td
                        key={c}
                        className="px-2 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400"
                      >
                        {m.byCategory[c] > 0 ? hoursLabel(m.byCategory[c]) : "—"}
                      </td>
                    ))}
                    <td className="py-2 pl-2 text-right font-medium tabular-nums">
                      {hoursLabel(m.total)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-200 dark:border-zinc-700">
                <td className="py-2 pr-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {t("allTime")}
                </td>
                {USAGE_CATEGORY_ORDER.map((c) => (
                  <td
                    key={c}
                    className="px-2 py-2 text-right font-medium tabular-nums"
                  >
                    {usage.allTime.byCategory[c] > 0
                      ? hoursLabel(usage.allTime.byCategory[c])
                      : "—"}
                  </td>
                ))}
                <td className="py-2 pl-2 text-right font-semibold tabular-nums">
                  {hoursLabel(usage.allTime.total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}
