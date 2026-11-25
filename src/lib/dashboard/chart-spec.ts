// ── What a chart widget's data looks like ─────────────────────────────────
//
// Plain, serialisable data the server hands to the chart component. Pure types
// (no React) so server loaders and the client chart share one definition. The
// server translates every label; colours are named tones the chart maps to hex,
// so this file stays free of presentation.

/** One labelled number: a status, a technician, an age bucket… */
export type Slice = { key: string; name: string; value: number };

/** Which colour map a category chart uses. `cycle` = a categorical rotation. */
export type CategoryPalette = "status" | "priority" | "cycle";

export type Tone = "blue" | "green" | "amber" | "purple" | "slate" | "red";

export type TrendSeries = { key: string; name: string; tone: Tone };
/** One x position and a value per series; `null` = no data that day (a gap,
 *  not a zero — an average over no tickets is not 0 hours). */
export type TrendRow = { date: string } & Record<string, string | number | null>;

export type ChartSpec =
  | { kind: "category"; palette: CategoryPalette; data: Slice[]; unit?: string }
  | { kind: "trend"; series: TrendSeries[]; data: TrendRow[]; unit?: string }
  /** One proportion, 0..1 (`null` = nothing to measure yet). */
  | { kind: "ratio"; value: number | null; label: string; detail?: string };

/** Words a chart needs, translated by the server. */
export type ChartLabels = {
  empty: string;
  name: string;
  value: string;
  date: string;
  /** The slice a pie or donut folds its smallest names into. */
  other: string;
};

/** What the server sends back for a widget's data. */
export type WidgetData = { subtitle?: string; spec: ChartSpec };
