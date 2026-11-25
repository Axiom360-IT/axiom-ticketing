"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  CategoryPalette,
  ChartLabels,
  ChartSpec,
  Slice,
  Tone,
  TrendRow,
  TrendSeries,
} from "@/lib/dashboard/chart-spec";
import type { ChartType } from "@/lib/dashboard/widgets";

// ── Dashboard charts ──────────────────────────────────────────────────────
//
// One component draws a widget's dataset in whichever chart type the person
// picked (see CHART_TYPES_BY_KIND for which types suit which data shape). The
// server passes translation-ready data and stays colour-agnostic; colours live
// here, keyed by the stable `key` or a named tone. Identity is never
// colour-alone: every chart carries a legend or axis labels plus a tooltip, and
// the "table" type is the fully text alternative.

// Stable status/priority → colour maps. These mirror the reports page palette
// and are validated CVD-safe.
const STATUS_COLORS: Record<string, string> = {
  open: "#3b82f6", // blue — active
  in_progress: "#f59e0b", // amber — being worked
  awaiting_customer_confirmation: "#a855f7", // purple — waiting on customer
  on_hold: "#64748b", // slate — paused
  resolved: "#10b981", // green — done, awaiting close
  closed: "#71717a", // zinc — inactive/archived
  other: "#8b5cf6", // violet — draft/escalation/etc.
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "#10b981",
  medium: "#3b82f6",
  high: "#f59e0b",
  critical: "#ef4444",
};

// For datasets without a meaning-bearing colour map: a categorical rotation, so
// two neighbouring slices never share a colour.
const CYCLE = ["#3b82f6", "#10b981", "#f59e0b", "#a855f7", "#ef4444", "#14b8a6", "#64748b", "#ec4899"];

const TONES: Record<Tone, string> = {
  blue: "#3b82f6",
  green: "#10b981",
  amber: "#f59e0b",
  purple: "#a855f7",
  slate: "#64748b",
  red: "#ef4444",
};

const AXIS = { tickLine: false, axisLine: false, fontSize: 12 } as const;
const GRID = "rgba(113,113,122,0.2)";
const MARGIN = { top: 8, right: 12, left: -12, bottom: 0 };

function colorFor(palette: CategoryPalette, key: string, index: number): string {
  if (palette === "cycle") return key === "other" ? "#a1a1aa" : CYCLE[index % CYCLE.length];
  return (palette === "status" ? STATUS_COLORS : PRIORITY_COLORS)[key] ?? STATUS_COLORS.other;
}

/** "12" or "12 h" — the unit travels with the number wherever it is shown. */
const withUnit = (v: unknown, unit?: string) => (unit ? `${v} ${unit}` : String(v));

// ── Categories ────────────────────────────────────────────────────────────

function CategoryChart({
  data,
  palette,
  type,
  unit,
}: {
  data: Slice[];
  palette: CategoryPalette;
  type: ChartType;
  unit?: string;
}) {
  const cells = data.map((d, i) => <Cell key={d.key} fill={colorFor(palette, d.key, i)} />);
  const tip = <Tooltip formatter={(v) => withUnit(v, unit)} cursor={{ fill: "rgba(113,113,122,0.08)" }} />;

  if (type === "donut" || type === "pie") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={type === "donut" ? "55%" : 0}
            outerRadius="85%"
            paddingAngle={type === "donut" ? 2 : 0}
            stroke="none"
          >
            {cells}
          </Pie>
          {tip}
          <Legend verticalAlign="bottom" height={28} iconType="circle" />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (type === "hbar") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
          <XAxis type="number" allowDecimals={unit === "h"} {...AXIS} />
          <YAxis type="category" dataKey="name" width={110} interval={0} {...AXIS} />
          {tip}
          <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={36}>
            {cells}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // "bar" (and the safe default for anything else)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={MARGIN}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="name" interval={0} {...AXIS} />
        <YAxis allowDecimals={unit === "h"} width={28} {...AXIS} />
        {tip}
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={72}>
          {cells}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Time series ───────────────────────────────────────────────────────────

function TrendChart({
  data,
  series,
  type,
  unit,
}: {
  data: TrendRow[];
  series: TrendSeries[];
  type: ChartType;
  unit?: string;
}) {
  // A day with no data is a gap (null), so on a sparse series some points have
  // no neighbour and a bare line would draw nothing — show the points then.
  const sparse = data.some((r) => series.some((s) => r[s.key] === null));
  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
      <XAxis dataKey="date" interval="preserveStartEnd" minTickGap={24} {...AXIS} />
      <YAxis allowDecimals={unit === "h"} width={unit ? 36 : 28} {...AXIS} />
      <Tooltip formatter={(v) => withUnit(v, unit)} />
      {series.length > 1 ? (
        <Legend verticalAlign="top" height={28} iconType={type === "line" ? "plainline" : "circle"} />
      ) : null}
    </>
  );

  if (type === "area") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={MARGIN}>
          {common}
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={TONES[s.tone]}
              fill={TONES[s.tone]}
              fillOpacity={0.18}
              strokeWidth={2}
              dot={sparse ? { r: 2.5 } : false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  if (type === "bar") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={MARGIN}>
          {common}
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} fill={TONES[s.tone]} radius={[3, 3, 0, 0]} maxBarSize={20} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // "line" (and the safe default)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={MARGIN}>
        {common}
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={TONES[s.tone]}
            strokeWidth={2}
            dot={sparse ? { r: 2.5 } : false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── One proportion ────────────────────────────────────────────────────────

const pct = (v: number) => `${Math.round(v * 100)}%`;

function RatioView({
  value,
  label,
  detail,
  type,
}: {
  value: number;
  label: string;
  detail?: string;
  type: ChartType;
}) {
  const text = (
    <div className="text-center">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">{label}</p>
      {detail ? <p className="text-xs text-zinc-500 dark:text-zinc-400">{detail}</p> : null}
    </div>
  );

  if (type === "number") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1">
        <p className="text-5xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{pct(value)}</p>
        {text}
      </div>
    );
  }

  // "ring": a plain SVG arc, so it scales with its widget and needs no chart library.
  const r = 50;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2">
      <svg viewBox="0 0 120 120" className="min-h-0 w-auto flex-1 max-h-56" aria-hidden="true">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="12" className="stroke-zinc-200 dark:stroke-zinc-800" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          strokeWidth="12"
          strokeLinecap="round"
          stroke={TONES.blue}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, Math.max(0, value)))}
          transform="rotate(-90 60 60)"
        />
        <text
          x="60"
          y="60"
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-zinc-900 text-[22px] font-semibold dark:fill-zinc-50"
        >
          {pct(value)}
        </text>
      </svg>
      {text}
    </div>
  );
}

// ── Text alternative ──────────────────────────────────────────────────────

const TH = "px-2 py-1.5 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400";
const TD = "px-2 py-1.5 tabular-nums";
const cell = (v: number | string | null, unit?: string) => (v === null ? "—" : withUnit(v, unit));

/** The same numbers as any chart, readable by anyone. */
function DataTable({ spec, labels }: { spec: ChartSpec; labels: ChartLabels }) {
  const head =
    spec.kind === "category" ? (
      <>
        <th scope="col" className={TH}>{labels.name}</th>
        <th scope="col" className={`${TH} text-right`}>{labels.value}</th>
      </>
    ) : spec.kind === "trend" ? (
      <>
        <th scope="col" className={TH}>{labels.date}</th>
        {spec.series.map((s) => (
          <th key={s.key} scope="col" className={`${TH} text-right`}>{s.name}</th>
        ))}
      </>
    ) : (
      <>
        <th scope="col" className={TH}>{labels.name}</th>
        <th scope="col" className={`${TH} text-right`}>{labels.value}</th>
      </>
    );

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white dark:bg-zinc-900">
          <tr className="border-b border-zinc-200 dark:border-zinc-800">{head}</tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {spec.kind === "category" &&
            spec.data.map((d) => (
              <tr key={d.key}>
                <td className={TD}>{d.name}</td>
                <td className={`${TD} text-right font-medium`}>{cell(d.value, spec.unit)}</td>
              </tr>
            ))}
          {spec.kind === "trend" &&
            spec.data.map((d) => (
              <tr key={d.date}>
                <td className={TD}>{d.date}</td>
                {spec.series.map((s) => (
                  <td key={s.key} className={`${TD} text-right`}>{cell(d[s.key] as number | null, spec.unit)}</td>
                ))}
              </tr>
            ))}
          {spec.kind === "ratio" && spec.value !== null && (
            <tr>
              <td className={TD}>
                {spec.label}
                {spec.detail ? <span className="block text-xs text-zinc-500">{spec.detail}</span> : null}
              </td>
              <td className={`${TD} text-right font-medium`}>{pct(spec.value)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Is there anything to draw? A zero is data for a trend; an all-zero category chart is not. */
function hasData(spec: ChartSpec): boolean {
  switch (spec.kind) {
    case "category":
      return spec.data.some((d) => d.value > 0);
    case "trend":
      return spec.data.some((r) => spec.series.some((s) => r[s.key] !== null));
    case "ratio":
      return spec.value !== null;
  }
}

/**
 * Draw a widget's dataset as the chosen chart type. Fills its parent (the parent
 * must have a height — the widget frame gives it one), so resizing a widget
 * resizes the chart.
 */
export function DashboardChart({
  spec,
  type,
  labels,
  title,
}: {
  spec: ChartSpec;
  type: ChartType;
  labels: ChartLabels;
  title: string;
}) {
  if (!hasData(spec)) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
        {labels.empty}
      </div>
    );
  }
  if (type === "table") return <DataTable spec={spec} labels={labels} />;

  if (spec.kind === "ratio") {
    return (
      <div role="img" aria-label={`${title}: ${spec.label} ${pct(spec.value ?? 0)}`} className="h-full min-h-0 w-full">
        <RatioView value={spec.value ?? 0} label={spec.label} detail={spec.detail} type={type} />
      </div>
    );
  }

  return (
    <div role="img" aria-label={title} className="h-full min-h-0 w-full">
      {spec.kind === "category" ? (
        <CategoryChart data={spec.data} palette={spec.palette} type={type} unit={spec.unit} />
      ) : (
        <TrendChart data={spec.data} series={spec.series} type={type} unit={spec.unit} />
      )}
    </div>
  );
}
