"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, type PieLabelRenderProps } from "recharts";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { ringSlices } from "@/lib/dashboard/chart-fit";
import type { ChartLabels, Slice } from "@/lib/dashboard/chart-spec";
import { healthOf, type Health } from "@/lib/dashboard/metrics";

// ── Health ring ───────────────────────────────────────────────────────────
//
// Active tickets by group, as two rings plus a table. The inner circle is each
// group's share; the outer ring splits that same share into on-track (a lighter
// shade of the group's colour) and overdue (red). Both start at the top and add
// up to the same total, so each outer segment sits over its own group. The table
// carries every number in text, so nothing depends on colour.

// No red or pink here: red means overdue.
const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#a855f7", "#06b6d4", "#64748b", "#84cc16", "#6366f1"];
const OTHER_COLOR = "#a1a1aa";
const OVERDUE_COLOR = "#dc2626";
/** A segment shorter than this (px, along the label's circle) has no room for its
 *  percentage; the tooltip has it. */
const MIN_LABEL_ARC = 28;

const HEALTH: Record<Health, { Icon: typeof CircleCheck; tone: string }> = {
  onTrack: { Icon: CircleCheck, tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  atRisk: { Icon: TriangleAlert, tone: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
  offTrack: { Icon: CircleAlert, tone: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
};

const SECTOR_GAPS = "[&_.recharts-sector]:stroke-white dark:[&_.recharts-sector]:stroke-zinc-900";

/** The share of the total, written inside a segment; `depth` places it between
 *  the segment's inner (0) and outer (1) edge. */
function percentLabel(depth: number) {
  return function PercentLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: PieLabelRenderProps) {
    const radius = Number(innerRadius) + (Number(outerRadius) - Number(innerRadius)) * depth;
    if (!percent || percent * 2 * Math.PI * radius < MIN_LABEL_ARC) return null;
    const angle = (-(midAngle ?? 0) * Math.PI) / 180;
    return (
      <text
        x={Number(cx) + radius * Math.cos(angle)}
        y={Number(cy) + radius * Math.sin(angle)}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#fff"
        stroke="rgba(0,0,0,0.45)"
        strokeWidth={3}
        paintOrder="stroke"
        fontSize={11}
        fontWeight={600}
      >
        {Math.round(percent * 100)}%
      </text>
    );
  };
}

const TH = "px-2 py-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 @max-[13rem]:px-1";
const TD = "px-2 py-1.5 @max-[13rem]:px-1";
// In the tiniest widget the names would vanish if all four columns stayed; the
// health column goes, and the two counts it is worked out from remain.
const HEALTH_COLUMN = "@max-[13rem]:hidden";

export function HealthRing({
  data,
  labels,
  title,
}: {
  data: readonly Slice[];
  labels: ChartLabels;
  title: string;
}) {
  const groups = ringSlices(data, labels.other).map((s, i) => ({
    ...s,
    overdue: s.overdue ?? 0,
    color: s.key === "other" ? OTHER_COLOR : COLORS[i % COLORS.length],
  }));
  const outer = groups.flatMap((g) =>
    [
      { key: `${g.key}:ok`, name: `${g.name}: ${labels.onTrack}`, value: g.value - g.overdue, color: g.color, opacity: 0.55 },
      { key: `${g.key}:late`, name: `${g.name}: ${labels.overdue}`, value: g.overdue, color: OVERDUE_COLOR, opacity: 1 },
    ].filter((s) => s.value > 0),
  );
  const ring = { dataKey: "value", nameKey: "name", startAngle: 90, endAngle: -270, labelLine: false, strokeWidth: 2 } as const;

  return (
    // The ring sits beside its table when there is room, above it when not.
    <div className="@container h-full">
      <div className="flex flex-col gap-3 @[28rem]:h-full @[28rem]:flex-row @[28rem]:items-center">
        <div
          role="img"
          aria-label={title}
          className="h-48 w-full shrink-0 @[28rem]:h-full @[28rem]:min-h-48 @[28rem]:w-2/5"
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie {...ring} data={groups.filter((g) => g.value > 0)} outerRadius="58%" label={percentLabel(0.62)} className={SECTOR_GAPS}>
                {groups.filter((g) => g.value > 0).map((g) => (
                  <Cell key={g.key} fill={g.color} />
                ))}
              </Pie>
              <Pie {...ring} data={outer} innerRadius="63%" outerRadius="98%" label={percentLabel(0.5)} className={SECTOR_GAPS}>
                {outer.map((s) => (
                  <Cell key={s.key} fill={s.color} fillOpacity={s.opacity} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="min-w-0 flex-1 @[28rem]:max-h-full @[28rem]:overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white dark:bg-zinc-900">
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th scope="col" className={`${TH} text-left`}>{labels.name}</th>
                <th scope="col" className={`${TH} text-right`}>{labels.open}</th>
                <th scope="col" className={`${TH} text-right`}>{labels.overdue}</th>
                <th scope="col" className={`${TH} ${HEALTH_COLUMN} text-left`}>{labels.health}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {groups.map((g) => {
                const state = healthOf(g.value, g.overdue);
                const { Icon, tone } = HEALTH[state];
                return (
                  <tr key={g.key}>
                    {/* takes the spare width, and truncates when there is none */}
                    <td className={`${TD} w-full max-w-0`}>
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: g.color }} aria-hidden="true" />
                        <span className="truncate" title={g.name}>{g.name}</span>
                      </span>
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>{g.value}</td>
                    <td
                      className={`${TD} text-right tabular-nums ${
                        g.overdue > 0 ? "font-semibold text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"
                      }`}
                    >
                      {g.overdue}
                    </td>
                    <td className={`${TD} ${HEALTH_COLUMN}`}>
                      <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
                        <Icon className="h-3 w-3" aria-hidden="true" />
                        {/* a narrow widget keeps the icon; the word stays for screen readers */}
                        <span className="@max-[20rem]:sr-only">{labels[state]}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
