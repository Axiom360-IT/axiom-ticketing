import { z } from "zod";
import {
  allowedChartTypes,
  availableWidgets,
  CHART_TYPES,
  GRID_COLS,
  getWidget,
  type ChartType,
  type Viewer,
  type WidgetDef,
  type WidgetId,
} from "./widgets";

// ── Dashboard layout ──────────────────────────────────────────────────────
//
// What a person saved: which widgets are on their dashboard, where, how big, and
// (for charts) which chart type. A widget NOT in `items` is simply hidden — it
// shows up in the "Add widget" list. There is no separate "hidden" list, so the
// two can never disagree.
//
// A saved layout is untrusted input by the time it is read back (an old save, a
// widget since removed, a permission since revoked, a hand-edited request), so
// every read and every save goes through `sanitizeLayout`, which only ever
// returns widgets the viewer is allowed and sizes the grid can draw.

export const LAYOUT_VERSION = 1;
const MAX_ROWS = 60; // generous ceiling on y / h, so a bad value can't make a giant page

export type LayoutItem = {
  id: WidgetId;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Chart widgets only; absent = the widget's default type. */
  chart?: ChartType;
};

export type DashboardLayout = {
  version: typeof LAYOUT_VERSION;
  items: LayoutItem[];
};

const CHART_TYPE = z.enum(CHART_TYPES);

// Shape only; ranges and permissions are enforced in sanitizeLayout so an
// out-of-range number is clamped rather than rejecting the whole layout.
const layoutSchema = z.object({
  version: z.literal(LAYOUT_VERSION),
  items: z
    .array(
      z.object({
        id: z.string(),
        x: z.number().finite(),
        y: z.number().finite(),
        w: z.number().finite(),
        h: z.number().finite(),
        chart: CHART_TYPE.optional(),
      }),
    )
    .max(100),
});

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Math.round(n)));

/**
 * Make an untrusted layout safe. Returns null when it is not a layout at all
 * (the caller falls back to the default). Otherwise: unknown widgets, widgets
 * this viewer may not have, and duplicates are dropped; sizes and positions are
 * clamped into the grid; a chart type the widget doesn't offer is discarded.
 */
export function sanitizeLayout(raw: unknown, viewer: Viewer): DashboardLayout | null {
  const parsed = layoutSchema.safeParse(raw);
  if (!parsed.success) return null;

  const allowed = new Set<string>(availableWidgets(viewer).map((w) => w.id));
  const seen = new Set<string>();
  const items: LayoutItem[] = [];

  for (const it of parsed.data.items) {
    const def = getWidget(it.id);
    if (!def || !allowed.has(def.id) || seen.has(def.id)) continue;
    seen.add(def.id);

    const w = clamp(it.w, def.size.minW, GRID_COLS);
    const h = clamp(it.h, def.size.minH, MAX_ROWS);
    const item: LayoutItem = {
      id: def.id,
      w,
      h,
      x: clamp(it.x, 0, GRID_COLS - w),
      y: clamp(it.y, 0, MAX_ROWS),
    };
    if (it.chart && allowedChartTypes(def).includes(it.chart)) item.chart = it.chart;
    items.push(item);
  }
  return { version: LAYOUT_VERSION, items };
}

/**
 * Lay widgets out left to right, wrapping to a new row when one doesn't fit.
 * The grid compacts upward afterwards, so rows only need to be roughly right.
 */
function pack(defs: readonly WidgetDef[]): LayoutItem[] {
  const items: LayoutItem[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const def of defs) {
    const { w, h } = def.size;
    if (x + w > GRID_COLS) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    items.push({ id: def.id, x, y, w, h });
    x += w;
    rowH = Math.max(rowH, h);
  }
  return items;
}

/**
 * The layout a person gets until they save their own: the original dashboard —
 * every widget they may see EXCEPT the on-demand ones, which are opt-in through
 * "Add widget". That keeps an unchanged dashboard unchanged, and means the page
 * never runs a query for a chart nobody asked to see.
 */
export function defaultLayout(viewer: Viewer): DashboardLayout {
  return {
    version: LAYOUT_VERSION,
    items: pack(availableWidgets(viewer).filter((w) => !w.lazy)),
  };
}

/** Widgets this person may have but currently doesn't show — the "Add" list. */
export function hiddenWidgets(layout: DashboardLayout, viewer: Viewer): WidgetDef[] {
  const shown = new Set<string>(layout.items.map((i) => i.id));
  return availableWidgets(viewer).filter((w) => !shown.has(w.id));
}

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: LayoutItem) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Put a widget on the dashboard at its starting size, in the first free spot at
 * the bottom: beside the last row's widgets if it fits there, otherwise below
 * everything. (Always dropping it at the left edge stacked half-width widgets in
 * one column with a blank half beside them.)
 */
export function addWidget(layout: DashboardLayout, def: WidgetDef): DashboardLayout {
  if (layout.items.some((i) => i.id === def.id)) return layout;
  const { w, h } = def.size;
  const bottom = layout.items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
  // Start from the top of whatever reaches lowest, so a gap beside the last row
  // is used but a gap far up the page is not.
  const lowest = layout.items.reduce<LayoutItem | null>(
    (m, i) => (!m || i.y + i.h > m.y + m.h ? i : m),
    null,
  );
  let spot = { x: 0, y: bottom };
  search: for (let y = lowest?.y ?? 0; y <= bottom; y++) {
    for (let x = 0; x <= GRID_COLS - w; x++) {
      if (!layout.items.some((i) => overlaps({ x, y, w, h }, i))) {
        spot = { x, y };
        break search;
      }
    }
  }
  return { ...layout, items: [...layout.items, { id: def.id, ...spot, w, h }] };
}

export function removeWidget(layout: DashboardLayout, id: WidgetId): DashboardLayout {
  return { ...layout, items: layout.items.filter((i) => i.id !== id) };
}

/** Set (or, for the widget's own default, clear) a chart widget's chart type. */
export function setChartType(
  layout: DashboardLayout,
  id: WidgetId,
  type: ChartType,
): DashboardLayout {
  const def = getWidget(id);
  if (!def?.chart || !allowedChartTypes(def).includes(type)) return layout;
  return {
    ...layout,
    items: layout.items.map((i) => {
      if (i.id !== id) return i;
      // The widget's own default is stored as "no choice", so a later change to
      // what the default is reaches everyone who never picked anything.
      const next: LayoutItem = { id: i.id, x: i.x, y: i.y, w: i.w, h: i.h };
      if (type !== def.chart!.default) next.chart = type;
      return next;
    }),
  };
}

/** The chart type to draw for a widget given its saved item. */
export function chartTypeFor(def: WidgetDef, item: LayoutItem | undefined): ChartType | null {
  if (!def.chart) return null;
  return item?.chart && allowedChartTypes(def).includes(item.chart)
    ? item.chart
    : def.chart.default;
}

/**
 * Merge the grid's reported positions back into the layout. The grid only knows
 * ids and rectangles; chart choices stay as they were. Unknown ids are ignored.
 */
export function applyGridPositions(
  layout: DashboardLayout,
  positions: readonly { i: string; x: number; y: number; w: number; h: number }[],
): DashboardLayout {
  const byId = new Map(positions.map((p) => [p.i, p]));
  let changed = false;
  const items = layout.items.map((it) => {
    const p = byId.get(it.id);
    if (!p || (p.x === it.x && p.y === it.y && p.w === it.w && p.h === it.h)) return it;
    changed = true;
    return { ...it, x: p.x, y: p.y, w: p.w, h: p.h };
  });
  // Same object back when nothing moved, so a no-op report from the grid (it
  // fires on mount and after every compaction) does not cause a re-render.
  return changed ? { ...layout, items } : layout;
}

/** Reading order for a single-column (phone) view: top to bottom, left to right. */
export function stackOrder(layout: DashboardLayout): LayoutItem[] {
  return [...layout.items].sort((a, b) => a.y - b.y || a.x - b.x);
}
