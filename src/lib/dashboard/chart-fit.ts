import type { Slice } from "./chart-spec";
import { topWithOther } from "./metrics";

// ── Fitting a chart into its widget ───────────────────────────────────────
//
// A widget can be a quarter of a desktop or the width of a phone, and a category
// chart may carry thirteen long names. These pure rules decide how many slices
// are drawn and how names are written, so nothing overlaps or is cut off.

/** Rough width of one character of 12px chart text. Deliberately generous. */
const CHAR_W = 6.8;

export function shorten(name: string, maxChars: number): string {
  if (name.length <= maxChars) return name;
  return `${name.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

const longestOf = (names: readonly string[]) =>
  names.reduce((m, n) => Math.max(m, n.length), 0);

// ── Pie and donut ─────────────────────────────────────────────────────────

/** As many named slices as there are distinct colours, so no two share one. */
export const MAX_RING_SLICES = 8;

/**
 * The slices a pie or donut draws: all of them when they fit, otherwise the
 * largest plus one "Other". ("Unassigned" and "No organization" are never folded
 * away.) The table and bar views still list every name.
 */
export function ringSlices(data: readonly Slice[], otherName: string): readonly Slice[] {
  if (data.filter((s) => s.key !== "other").length <= MAX_RING_SLICES) return data;
  return topWithOther(data, MAX_RING_SLICES, otherName, ["unassigned", "none"]);
}

// ── Names under vertical bars ─────────────────────────────────────────────

const MAX_ANGLED_CHARS = 14;
const MIN_ANGLED_CHARS = 5;
/** Slanted names may take this share of the chart's height; the bars get the rest. */
const MAX_NAME_SHARE = 0.4;
/** Closer together than this and even slanted names collide. */
const MIN_ANGLED_BAND = 18;
const LINE_HEIGHT = 14;
/** The number axis beside the bars sizes itself, within about this range. */
const VALUE_AXIS_MIN = 14;
const VALUE_AXIS_MAX = 36;

export type BarLabelFit = {
  /** Written at 45° because they don't fit side by side. */
  angled: boolean;
  maxChars: number;
  /** Height the name axis needs. */
  height: number;
  /** Extra left margin so the first slanted name isn't cut off. */
  paddingLeft: number;
  /** False when there are too many to label each one (the tooltip still names them). */
  showAll: boolean;
};

export function fitBarLabels(
  names: readonly string[],
  chartWidth: number,
  chartHeight = 0,
): BarLabelFit {
  const longest = longestOf(names);
  const band = Math.max(0, chartWidth - VALUE_AXIS_MAX) / Math.max(1, names.length);
  if (longest === 0 || longest * CHAR_W + 6 <= band) {
    return { angled: false, maxChars: longest, height: 24, paddingLeft: 0, showAll: true };
  }
  // In a short chart the names get shorter so they don't crowd out the bars.
  const roomFor = chartHeight
    ? Math.floor((chartHeight * MAX_NAME_SHARE - 20) / (CHAR_W * Math.SQRT1_2))
    : MAX_ANGLED_CHARS;
  const slanted = (maxChars: number): BarLabelFit => {
    // At 45° a name reaches equally far left and down: its length plus the
    // height of the letters.
    const reach = Math.ceil((maxChars * CHAR_W + LINE_HEIGHT) * Math.SQRT1_2);
    const paddingLeft = Math.max(0, Math.ceil(reach - VALUE_AXIS_MIN - band / 2));
    // That margin narrows the bars, so judge the spacing with it taken off.
    const spacing = Math.max(0, chartWidth - VALUE_AXIS_MAX - paddingLeft) / names.length;
    return {
      angled: true,
      maxChars,
      height: reach + 16,
      paddingLeft,
      showAll: spacing >= MIN_ANGLED_BAND,
    };
  };

  // In a narrow chart, shortening the names further keeps every bar labelled.
  let maxChars = Math.min(longest, MAX_ANGLED_CHARS, Math.max(MIN_ANGLED_CHARS, roomFor));
  let fit = slanted(maxChars);
  while (!fit.showAll && maxChars > MIN_ANGLED_CHARS) fit = slanted(--maxChars);
  return fit;
}

// ── Names beside horizontal bars ──────────────────────────────────────────

/** Height one horizontal bar needs for its name; a shorter widget scrolls. */
export const HBAR_ROW_HEIGHT = 22;

/** As wide as the longest name needs, up to 40% of the chart (80–180px). */
export function fitNameAxis(
  names: readonly string[],
  chartWidth: number,
): { width: number; maxChars: number } {
  const cap = Math.max(80, Math.min(180, Math.floor(chartWidth * 0.4)));
  const width = Math.min(cap, Math.max(40, Math.ceil(longestOf(names) * CHAR_W) + 10));
  return { width, maxChars: Math.floor((width - 10) / CHAR_W) };
}
