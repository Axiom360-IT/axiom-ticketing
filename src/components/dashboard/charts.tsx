"use client";

import {
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

// Stable status/priority → colour maps. Kept here (client) so the server can
// pass translation-ready { key, name, value } data and stay colour-agnostic.
// These mirror the reports page palette and are validated CVD-safe; identity is
// never colour-alone (every chart carries a legend + labels + tooltip).
const STATUS_COLORS: Record<string, string> = {
  open: "#3b82f6", // blue — active
  in_progress: "#f59e0b", // amber — being worked
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

const AXIS = {
  tickLine: false,
  axisLine: false,
  fontSize: 12,
} as const;

type Slice = { key: string; name: string; value: number };

/** Ticket count by status — a donut with a legend + hover tooltip. */
export function StatusDonut({ data }: { data: Slice[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={56}
          outerRadius={86}
          paddingAngle={2}
          stroke="none"
        >
          {data.map((d) => (
            <Cell key={d.key} fill={STATUS_COLORS[d.key] ?? STATUS_COLORS.other} />
          ))}
        </Pie>
        <Tooltip />
        <Legend verticalAlign="bottom" height={28} iconType="circle" />
      </PieChart>
    </ResponsiveContainer>
  );
}

type TrendPoint = { date: string; created: number; resolved: number };

/** Created vs resolved over the trailing window — two-series line chart. */
export function TrendLineChart({
  data,
  createdLabel,
  resolvedLabel,
}: {
  data: TrendPoint[];
  createdLabel: string;
  resolvedLabel: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(113,113,122,0.2)" vertical={false} />
        <XAxis dataKey="date" interval="preserveStartEnd" minTickGap={24} {...AXIS} />
        <YAxis allowDecimals={false} width={28} {...AXIS} />
        <Tooltip />
        <Legend verticalAlign="top" height={28} iconType="plainline" />
        <Line
          type="monotone"
          dataKey="created"
          name={createdLabel}
          stroke="#3b82f6"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="resolved"
          name={resolvedLabel}
          stroke="#10b981"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Active tickets by priority — single-series bar, coloured by severity. */
export function PriorityBar({ data }: { data: Slice[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(113,113,122,0.2)" vertical={false} />
        <XAxis dataKey="name" {...AXIS} />
        <YAxis allowDecimals={false} width={28} {...AXIS} />
        <Tooltip cursor={{ fill: "rgba(113,113,122,0.08)" }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={72}>
          {data.map((d) => (
            <Cell
              key={d.key}
              fill={PRIORITY_COLORS[d.key] ?? STATUS_COLORS.other}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
