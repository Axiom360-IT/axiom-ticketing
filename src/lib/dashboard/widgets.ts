// ── Dashboard widgets ─────────────────────────────────────────────────────
//
// The landing dashboard is a set of WIDGETS a person can arrange, resize, hide
// and bring back. This file is the catalogue: which widgets exist, who may see
// each, how big each starts, and which chart types suit its data. It is pure
// (no React, no database) so the rules are unit-tested; the layout rules that
// sit on top of it live in ./layout.ts.
//
// Visibility rules mirror what the dashboard did before widgets existed — a
// widget is offered only to someone who could already see that data — so adding
// a widget here never widens what anyone can read. A widget that is available
// but has nothing to show right now (e.g. "SLA deadlines" on a clean day) is
// still handled by the page: it renders empty and the grid collapses the gap.

export const GRID_COLS = 12;

// ── Chart types ───────────────────────────────────────────────────────────

// The one list of chart types. The layout validator derives its accepted values
// from it, so a new type cannot be offered here yet rejected when a layout that
// uses it is saved or read back.
export const CHART_TYPES = [
  "bar",
  "hbar",
  "donut",
  "pie",
  "line",
  "area",
  "ring",
  "number",
  "table",
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/**
 * The shape of a chart widget's data decides which chart types make sense:
 *   category  one number per label (status, priority, per technician…)
 *   trend     numbers over time, one or more series
 *   ratio     a single proportion (SLA compliance, escalation rate)
 * A pie of a time series, a line through unordered categories, or a bar chart of
 * one percentage would mislead — so a widget only ever offers the types listed
 * for its shape.
 */
export type DatasetKind = "category" | "trend" | "ratio";

export const CHART_TYPES_BY_KIND: Record<DatasetKind, readonly ChartType[]> = {
  category: ["bar", "hbar", "donut", "pie", "table"],
  trend: ["line", "area", "bar", "table"],
  ratio: ["ring", "number", "table"],
};

// ── Widgets ───────────────────────────────────────────────────────────────

export const WIDGET_IDS = [
  "myQueue",
  "sla",
  "escalations",
  "triage",
  "planWatch",
  "stat.total",
  "stat.open",
  "stat.unassigned",
  "stat.awaiting",
  "stat.onHold",
  "stat.resolved",
  "csat",
  "chart.trend",
  "chart.status",
  "chart.priority",
  // Phase 2 — each loads its own data on demand (see `lazy` below).
  "chart.byTechnician",
  "chart.byCategory",
  "chart.byType",
  "chart.byStream",
  "chart.byOrganization",
  "chart.age",
  "chart.backlog",
  "chart.firstResponse",
  "chart.resolutionTime",
  "chart.csatTrend",
  "ratio.sla",
  "ratio.escalation",
  "chart.hoursByTechnician",
  "chart.hoursByBilling",
] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];

export type WidgetGroup = "stats" | "charts" | "panels";

/** What the widget rules need to know about the person looking. */
export type Viewer = {
  /** A user whose only role is Technician: their dashboard is My Queue alone. */
  strictTech: boolean;
  permissions: ReadonlySet<string>;
};

export type WidgetSize = { w: number; h: number; minW: number; minH: number };

export type WidgetDef = {
  id: WidgetId;
  group: WidgetGroup;
  /** Starting size, in grid units (see GRID_ROW_HEIGHT in the grid component). */
  size: WidgetSize;
  /** Present for chart widgets: the data shape and the type shown by default. */
  chart?: { kind: DatasetKind; default: ChartType };
  /**
   * `lazy` widgets are pure chart data: the page loads their data only when the
   * widget is on the person's dashboard, and the browser asks for it when one is
   * added. Without this, every widget someone has hidden would still cost a
   * query on every dashboard load. The older panels render server-side markup,
   * so they are always loaded (as before).
   */
  lazy?: boolean;
  /** i18n key under `admin.landing.metrics` holding `title` (and `subtitle`). */
  metricKey?: string;
  isAvailable: (v: Viewer) => boolean;
};

const canViewTickets = (v: Viewer) => v.permissions.has("tickets.view");
const oversight = (v: Viewer) => !v.strictTech && canViewTickets(v);
// Counting tickets per organization also names organizations, so it needs the
// permission that gates the organization pages.
const orgOversight = (v: Viewer) => oversight(v) && v.permissions.has("organizations.view");
// Hours logged per person / per billing type is commercial data.
const hoursViewer = (v: Viewer) => !v.strictTech && v.permissions.has("worklog.view_all");

function lazyChart(
  id: WidgetId,
  metricKey: string,
  isAvailable: (v: Viewer) => boolean,
  size: WidgetSize,
  kind: DatasetKind,
  defaultType: ChartType,
): WidgetDef {
  return { id, group: "charts", size, chart: { kind, default: defaultType }, lazy: true, metricKey, isAvailable };
}

// Order matters: it is the order the default layout is packed in, and it keeps
// the old page's reading order (personal work first, then oversight, then the
// numbers, then the charts).
export const WIDGETS: readonly WidgetDef[] = [
  {
    id: "myQueue",
    group: "panels",
    size: { w: 12, h: 5, minW: 6, minH: 3 },
    isAvailable: canViewTickets,
  },
  {
    id: "sla",
    group: "panels",
    size: { w: 12, h: 9, minW: 6, minH: 5 },
    isAvailable: oversight,
  },
  {
    id: "escalations",
    group: "panels",
    size: { w: 12, h: 7, minW: 6, minH: 4 },
    isAvailable: oversight,
  },
  {
    id: "triage",
    group: "panels",
    size: { w: 12, h: 4, minW: 6, minH: 3 },
    isAvailable: (v) =>
      !v.strictTech &&
      (v.permissions.has("tickets.update") ||
        v.permissions.has("organizations.update")),
  },
  {
    id: "planWatch",
    group: "panels",
    size: { w: 12, h: 6, minW: 6, minH: 3 },
    isAvailable: (v) => !v.strictTech && v.permissions.has("organizations.view"),
  },
  { id: "stat.total", group: "stats", size: { w: 2, h: 2, minW: 2, minH: 2 }, isAvailable: oversight },
  { id: "stat.open", group: "stats", size: { w: 2, h: 2, minW: 2, minH: 2 }, isAvailable: oversight },
  {
    id: "stat.unassigned",
    group: "stats",
    size: { w: 2, h: 2, minW: 2, minH: 2 },
    isAvailable: (v) => !v.strictTech && v.permissions.has("tickets.assign"),
  },
  { id: "stat.awaiting", group: "stats", size: { w: 2, h: 2, minW: 2, minH: 2 }, isAvailable: oversight },
  { id: "stat.onHold", group: "stats", size: { w: 2, h: 2, minW: 2, minH: 2 }, isAvailable: oversight },
  { id: "stat.resolved", group: "stats", size: { w: 2, h: 2, minW: 2, minH: 2 }, isAvailable: oversight },
  {
    id: "csat",
    group: "panels",
    size: { w: 12, h: 8, minW: 6, minH: 4 },
    isAvailable: oversight,
  },
  {
    id: "chart.trend",
    group: "charts",
    size: { w: 12, h: 7, minW: 4, minH: 6 },
    chart: { kind: "trend", default: "line" },
    isAvailable: oversight,
  },
  {
    id: "chart.status",
    group: "charts",
    size: { w: 6, h: 7, minW: 3, minH: 6 },
    chart: { kind: "category", default: "donut" },
    isAvailable: oversight,
  },
  {
    id: "chart.priority",
    group: "charts",
    size: { w: 6, h: 7, minW: 3, minH: 6 },
    chart: { kind: "category", default: "bar" },
    isAvailable: oversight,
  },
  // ── Phase 2: ticket mix ──────────────────────────────────────────────
  lazyChart("chart.byTechnician", "byTechnician", oversight, { w: 6, h: 8, minW: 3, minH: 6 }, "category", "hbar"),
  lazyChart("chart.byCategory", "byCategory", oversight, { w: 6, h: 7, minW: 3, minH: 6 }, "category", "donut"),
  lazyChart("chart.byType", "byType", oversight, { w: 6, h: 7, minW: 3, minH: 6 }, "category", "bar"),
  lazyChart("chart.byStream", "byStream", oversight, { w: 4, h: 7, minW: 3, minH: 6 }, "category", "donut"),
  lazyChart("chart.byOrganization", "byOrganization", orgOversight, { w: 6, h: 8, minW: 3, minH: 6 }, "category", "hbar"),
  lazyChart("chart.age", "age", oversight, { w: 6, h: 7, minW: 3, minH: 6 }, "category", "bar"),
  // ── Phase 2: over time ───────────────────────────────────────────────
  lazyChart("chart.backlog", "backlog", oversight, { w: 6, h: 7, minW: 4, minH: 6 }, "trend", "area"),
  lazyChart("chart.firstResponse", "firstResponse", oversight, { w: 6, h: 7, minW: 4, minH: 6 }, "trend", "line"),
  lazyChart("chart.resolutionTime", "resolutionTime", oversight, { w: 6, h: 7, minW: 4, minH: 6 }, "trend", "line"),
  lazyChart("chart.csatTrend", "csatTrend", oversight, { w: 6, h: 7, minW: 4, minH: 6 }, "trend", "line"),
  // ── Phase 2: single numbers ──────────────────────────────────────────
  lazyChart("ratio.sla", "sla", oversight, { w: 3, h: 6, minW: 2, minH: 5 }, "ratio", "ring"),
  lazyChart("ratio.escalation", "escalation", oversight, { w: 3, h: 6, minW: 2, minH: 5 }, "ratio", "ring"),
  // ── Phase 2: time logged (commercially sensitive: needs worklog.view_all) ─
  lazyChart("chart.hoursByTechnician", "hoursByTechnician", hoursViewer, { w: 6, h: 8, minW: 3, minH: 6 }, "category", "hbar"),
  lazyChart("chart.hoursByBilling", "hoursByBilling", hoursViewer, { w: 6, h: 7, minW: 3, minH: 6 }, "category", "donut"),
];

const BY_ID = new Map<string, WidgetDef>(WIDGETS.map((w) => [w.id, w]));

/**
 * Panels are lists whose length changes daily, so no starting height is right for
 * them: their height follows their content until the person resizes one.
 */
export function fitsContent(def: WidgetDef): boolean {
  return def.group === "panels";
}

/** Widgets whose data is loaded on demand rather than with the page. */
export function isLazyWidget(id: string): boolean {
  return BY_ID.get(id)?.lazy === true;
}

export function getWidget(id: string): WidgetDef | undefined {
  return BY_ID.get(id);
}

/** The widgets this person may have on their dashboard, in catalogue order. */
export function availableWidgets(v: Viewer): WidgetDef[] {
  return WIDGETS.filter((w) => w.isAvailable(v));
}

/** Chart types a widget offers (empty for a non-chart widget). */
export function allowedChartTypes(def: WidgetDef): readonly ChartType[] {
  return def.chart ? CHART_TYPES_BY_KIND[def.chart.kind] : [];
}
