"use client";

import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const PIE_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#71717a", "#ef4444", "#8b5cf6"];

type PieDatum = { name: string; value: number };

export function StatusPie({ data }: { data: PieDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={50}
          outerRadius={80}
          paddingAngle={2}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
        <Legend verticalAlign="bottom" height={24} />
      </PieChart>
    </ResponsiveContainer>
  );
}

type GroupedBarDatum = { name: string; assigned: number; resolved: number };

export function TechLoadBar({
  data,
  assignedLabel,
  resolvedLabel,
}: {
  data: GroupedBarDatum[];
  assignedLabel: string;
  resolvedLabel: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 32 + 40)}>
      <BarChart data={data} layout="vertical" margin={{ left: 16, right: 16 }}>
        <XAxis type="number" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis
          dataKey="name"
          type="category"
          width={120}
          tickLine={false}
          axisLine={false}
          fontSize={12}
        />
        <Tooltip />
        <Legend verticalAlign="top" height={24} />
        <Bar dataKey="assigned" name={assignedLabel} fill="#3b82f6" radius={[0, 4, 4, 0]} />
        <Bar dataKey="resolved" name={resolvedLabel} fill="#10b981" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StageBar({ data }: { data: { name: string; total: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 32 + 40)}>
      <BarChart data={data} layout="vertical" margin={{ left: 16, right: 16 }}>
        <XAxis type="number" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis
          dataKey="name"
          type="category"
          width={140}
          tickLine={false}
          axisLine={false}
          fontSize={12}
        />
        <Tooltip />
        <Bar dataKey="total" fill="#3b82f6" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
