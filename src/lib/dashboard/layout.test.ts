import { describe, expect, it } from "vitest";
import {
  addWidget,
  applyGridPositions,
  chartTypeFor,
  defaultLayout,
  displayHeight,
  hiddenWidgets,
  removeWidget,
  rowsForHeight,
  sanitizeLayout,
  setChartType,
  setFixedHeight,
  stackOrder,
  type DashboardLayout,
} from "./layout";
import {
  allowedChartTypes,
  availableWidgets,
  CHART_TYPES_BY_KIND,
  fitsContent,
  getWidget,
  GRID_COLS,
  isLazyWidget,
  WIDGET_IDS,
  WIDGETS,
  type Viewer,
} from "./widgets";

const viewer = (perms: string[], strictTech = false): Viewer => ({
  strictTech,
  permissions: new Set(perms),
});
const ADMIN = viewer([
  "tickets.view",
  "tickets.assign",
  "tickets.update",
  "organizations.view",
  "organizations.update",
  "worklog.view_all",
]);

const ids = (l: DashboardLayout) => l.items.map((i) => i.id);

describe("widget catalogue", () => {
  it("defines every widget id exactly once", () => {
    expect(WIDGETS.map((w) => w.id)).toEqual([...WIDGET_IDS]);
    expect(new Set(WIDGETS.map((w) => w.id)).size).toBe(WIDGETS.length);
  });

  it("gives every widget a size that fits the grid and a valid minimum", () => {
    for (const w of WIDGETS) {
      expect(w.size.minW).toBeGreaterThan(0);
      expect(w.size.minH).toBeGreaterThan(0);
      expect(w.size.w).toBeGreaterThanOrEqual(w.size.minW);
      expect(w.size.w).toBeLessThanOrEqual(GRID_COLS);
      expect(w.size.h).toBeGreaterThanOrEqual(w.size.minH);
    }
  });

  it("only offers a chart widget's default type if its data shape allows it", () => {
    for (const w of WIDGETS.filter((x) => x.chart)) {
      expect(CHART_TYPES_BY_KIND[w.chart!.kind]).toContain(w.chart!.default);
    }
  });

  it("never offers a pie or donut for a time series, or a line for categories", () => {
    expect(CHART_TYPES_BY_KIND.trend).not.toContain("pie");
    expect(CHART_TYPES_BY_KIND.trend).not.toContain("donut");
    expect(CHART_TYPES_BY_KIND.category).not.toContain("line");
    expect(CHART_TYPES_BY_KIND.category).not.toContain("area");
  });
});

describe("who may have which widget", () => {
  it("a strict Technician gets My Queue only, whatever else they hold", () => {
    expect(
      ids({ version: 1, items: availableWidgets(viewer(["tickets.view", "tickets.assign", "organizations.view"], true)).map((w) => ({ id: w.id, x: 0, y: 0, w: 1, h: 1 })) }),
    ).toEqual(["myQueue"]);
  });

  it("someone with no permissions gets nothing", () => {
    expect(availableWidgets(viewer([]))).toEqual([]);
  });

  it("an admin with every permission gets the whole catalogue", () => {
    expect(availableWidgets(ADMIN).map((w) => w.id)).toEqual([...WIDGET_IDS]);
  });

  it("'Unassigned' needs the assign permission, the other tiles only view", () => {
    const viewOnly = availableWidgets(viewer(["tickets.view"])).map((w) => w.id);
    expect(viewOnly).toContain("stat.total");
    expect(viewOnly).not.toContain("stat.unassigned");
    expect(
      availableWidgets(viewer(["tickets.view", "tickets.assign"])).map((w) => w.id),
    ).toContain("stat.unassigned");
  });

  it("triage and plan watch follow their destination pages' permissions", () => {
    expect(availableWidgets(viewer(["tickets.update"])).map((w) => w.id)).toEqual(["triage"]);
    expect(availableWidgets(viewer(["organizations.update"])).map((w) => w.id)).toEqual(["triage"]);
    expect(availableWidgets(viewer(["organizations.view"])).map((w) => w.id)).toEqual(["planWatch"]);
  });
});

describe("phase 2 widgets", () => {
  const lazy = WIDGETS.filter((w) => w.lazy);

  it("adds fourteen on-demand chart widgets, each with a chart shape and a message key", () => {
    expect(lazy).toHaveLength(14);
    for (const w of lazy) {
      expect(w.chart, w.id).toBeDefined();
      expect(w.metricKey, w.id).toBeTruthy();
      expect(isLazyWidget(w.id)).toBe(true);
    }
    expect(new Set(lazy.map((w) => w.metricKey)).size).toBe(lazy.length);
    // the older panels render server markup, so they are never lazy
    expect(isLazyWidget("sla")).toBe(false);
    expect(isLazyWidget("chart.status")).toBe(false);
    expect(isLazyWidget("nope")).toBe(false);
  });

  it("offers a single proportion only a ring, a number or a table", () => {
    expect(CHART_TYPES_BY_KIND.ratio).toEqual(["ring", "number", "table"]);
    for (const w of lazy.filter((x) => x.chart!.kind === "ratio")) {
      expect(allowedChartTypes(w)).not.toContain("bar");
      expect(allowedChartTypes(w)).not.toContain("pie");
    }
    expect(CHART_TYPES_BY_KIND.category).not.toContain("ring");
    expect(CHART_TYPES_BY_KIND.trend).not.toContain("ring");
  });

  it("hours widgets need worklog.view_all, and nothing else grants them", () => {
    const hours = ["chart.hoursByTechnician", "chart.hoursByBilling"];
    const everythingButHours = viewer(["tickets.view", "tickets.assign", "tickets.update", "organizations.view", "reports.view"]);
    const got = availableWidgets(everythingButHours).map((w) => w.id);
    for (const id of hours) expect(got).not.toContain(id);
    const withHours = availableWidgets(viewer(["worklog.view_all"])).map((w) => w.id);
    expect(withHours).toEqual(hours);
  });

  it("tickets by organization also needs organizations.view", () => {
    const noOrg = availableWidgets(viewer(["tickets.view"])).map((w) => w.id);
    expect(noOrg).not.toContain("chart.byOrganization");
    expect(noOrg).toContain("chart.byTechnician");
    expect(
      availableWidgets(viewer(["tickets.view", "organizations.view"])).map((w) => w.id),
    ).toContain("chart.byOrganization");
  });

  it("a strict Technician gets none of them, whatever else they hold", () => {
    const ids = availableWidgets(
      viewer(["tickets.view", "organizations.view", "worklog.view_all"], true),
    ).map((w) => w.id);
    expect(ids).toEqual(["myQueue"]);
  });

  it("sanitising drops a lazy widget the viewer is not allowed (revoked permission)", () => {
    const saved = {
      version: 1,
      items: [
        { id: "chart.hoursByTechnician", x: 0, y: 0, w: 6, h: 8 },
        { id: "chart.byTechnician", x: 6, y: 0, w: 6, h: 8 },
      ],
    };
    const out = sanitizeLayout(saved, viewer(["tickets.view"]))!;
    expect(ids(out)).toEqual(["chart.byTechnician"]);
  });

  it("a ratio widget accepts a ring but discards a bar from a saved layout", () => {
    const l = (chart: string) => ({ version: 1, items: [{ id: "ratio.sla", x: 0, y: 0, w: 3, h: 6, chart }] });
    expect(sanitizeLayout(l("number"), ADMIN)!.items[0].chart).toBe("number");
    expect(sanitizeLayout(l("bar"), ADMIN)!.items[0].chart).toBeUndefined();
  });
});

describe("defaultLayout", () => {
  it("contains the widgets the viewer may have, in catalogue order, minus the opt-in on-demand ones", () => {
    const base = WIDGETS.filter((w) => !w.lazy).map((w) => w.id);
    expect(ids(defaultLayout(ADMIN))).toEqual(base);
    expect(ids(defaultLayout(ADMIN)).some((id) => isLazyWidget(id))).toBe(false);
    expect(ids(defaultLayout(viewer(["tickets.view"], true)))).toEqual(["myQueue"]);
  });

  it("stays inside the grid and never overlaps two widgets", () => {
    const { items } = defaultLayout(ADMIN);
    for (const a of items) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w).toBeLessThanOrEqual(GRID_COLS);
    }
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        const overlap =
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it("puts the six stat tiles side by side on one row", () => {
    const tiles = defaultLayout(ADMIN).items.filter((i) => i.id.startsWith("stat."));
    expect(tiles).toHaveLength(6);
    expect(new Set(tiles.map((t) => t.y)).size).toBe(1);
    expect(tiles.map((t) => t.x)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it("has every chart on its default type (nothing saved)", () => {
    for (const i of defaultLayout(ADMIN).items) expect(i.chart).toBeUndefined();
  });
});

describe("sanitizeLayout", () => {
  const item = (o: Record<string, unknown>) => ({ id: "stat.total", x: 0, y: 0, w: 2, h: 2, ...o });
  const wrap = (items: unknown[]) => ({ version: 1, items });

  it("returns null for anything that is not a layout, so the default is used", () => {
    for (const bad of [null, undefined, 42, "x", [], {}, { version: 2, items: [] }, { version: 1 }, { version: 1, items: "no" }]) {
      expect(sanitizeLayout(bad, ADMIN)).toBeNull();
    }
  });

  it("keeps a valid layout as it is", () => {
    const l = wrap([item({}), item({ id: "chart.status", w: 6, h: 7, chart: "pie" })]);
    expect(sanitizeLayout(l, ADMIN)).toEqual({
      version: 1,
      items: [
        { id: "stat.total", x: 0, y: 0, w: 2, h: 2 },
        { id: "chart.status", x: 0, y: 0, w: 6, h: 7, chart: "pie" },
      ],
    });
  });

  it("drops unknown widgets and ones the viewer is not allowed (revoked permission)", () => {
    const l = wrap([item({}), item({ id: "no.such.widget" }), item({ id: "planWatch", w: 12, h: 6 })]);
    expect(ids(sanitizeLayout(l, viewer(["tickets.view"]))!)).toEqual(["stat.total"]);
  });

  it("drops a duplicate widget, keeping the first", () => {
    const l = wrap([item({ x: 4 }), item({ x: 8 })]);
    const out = sanitizeLayout(l, ADMIN)!;
    expect(out.items).toHaveLength(1);
    expect(out.items[0].x).toBe(4);
  });

  it("clamps sizes to the widget's minimum and the grid, and positions into the grid", () => {
    const out = sanitizeLayout(wrap([item({ x: 99, y: -5, w: 0, h: 0 })]), ADMIN)!;
    const def = getWidget("stat.total")!;
    expect(out.items[0].w).toBe(def.size.minW);
    expect(out.items[0].h).toBe(def.size.minH);
    expect(out.items[0].x).toBe(GRID_COLS - def.size.minW);
    expect(out.items[0].y).toBe(0);

    const wide = sanitizeLayout(wrap([item({ w: 500, h: 5000 })]), ADMIN)!.items[0];
    expect(wide.w).toBe(GRID_COLS);
    expect(wide.x).toBe(0);
    expect(wide.h).toBeLessThanOrEqual(60);
  });

  it("rounds fractional values and rejects NaN/Infinity", () => {
    expect(sanitizeLayout(wrap([item({ x: 1.6, y: 2.2 })]), ADMIN)!.items[0]).toMatchObject({ x: 2, y: 2 });
    expect(sanitizeLayout(wrap([item({ x: Number.NaN })]), ADMIN)).toBeNull();
    expect(sanitizeLayout(wrap([item({ w: Infinity })]), ADMIN)).toBeNull();
  });

  it("discards a chart type the widget does not offer, and one on a non-chart widget", () => {
    const l = wrap([
      item({ id: "chart.trend", w: 12, h: 7, chart: "pie" }), // pie of a time series
      item({ id: "stat.open", chart: "bar" }), // not a chart widget
    ]);
    const out = sanitizeLayout(l, ADMIN)!;
    expect(out.items.find((i) => i.id === "chart.trend")!.chart).toBeUndefined();
    expect(out.items.find((i) => i.id === "stat.open")!.chart).toBeUndefined();
  });

  it("rejects an unknown chart type outright (shape check)", () => {
    expect(sanitizeLayout(wrap([item({ id: "chart.status", chart: "radar" })]), ADMIN)).toBeNull();
  });

  it("caps an absurd number of items", () => {
    const many = Array.from({ length: 101 }, () => item({}));
    expect(sanitizeLayout(wrap(many), ADMIN)).toBeNull();
  });
});

describe("editing a layout", () => {
  it("hidden widgets are exactly the available ones not on the dashboard", () => {
    // The default dashboard leaves out the opt-in on-demand widgets, so they are
    // what "Add widget" offers to begin with.
    const optIn = WIDGETS.filter((w) => w.lazy).map((w) => w.id);
    let l = defaultLayout(ADMIN);
    expect(hiddenWidgets(l, ADMIN).map((w) => w.id)).toEqual(optIn);
    l = removeWidget(l, "csat");
    l = removeWidget(l, "chart.priority");
    expect(hiddenWidgets(l, ADMIN).map((w) => w.id)).toEqual(["csat", "chart.priority", ...optIn]);
  });

  it("adds a hidden widget back at the bottom at its starting size, once", () => {
    const l = removeWidget(defaultLayout(ADMIN), "csat");
    const bottom = l.items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
    const back = addWidget(l, getWidget("csat")!);
    const csat = back.items.find((i) => i.id === "csat")!;
    expect(csat).toMatchObject({ x: 0, y: bottom, w: 12, h: 8 });
    expect(addWidget(back, getWidget("csat")!)).toBe(back);
  });

  describe("where an added widget lands", () => {
    const at = (id: string, x: number, y: number, w: number, h: number) => ({ id: id as never, x, y, w, h });
    const base = (items: ReturnType<typeof at>[]): DashboardLayout => ({ version: 1, items });

    it("goes to the top-left of an empty dashboard", () => {
      const out = addWidget(base([]), getWidget("chart.byStream")!);
      expect(out.items[0]).toMatchObject({ x: 0, y: 0 });
    });

    it("sits beside the last row's widget when there is room", () => {
      const l = base([at("chart.status", 0, 0, 6, 7)]);
      const out = addWidget(l, getWidget("chart.priority")!); // 6 wide
      expect(out.items.at(-1)).toMatchObject({ x: 6, y: 0, w: 6 });
    });

    it("goes below when the last row is full width", () => {
      const l = base([at("csat", 0, 0, 12, 8)]);
      const out = addWidget(l, getWidget("chart.status")!);
      expect(out.items.at(-1)).toMatchObject({ x: 0, y: 8 });
    });

    it("goes below when the widget is too wide for the gap beside the last row", () => {
      const l = base([at("chart.status", 0, 0, 6, 7)]);
      const out = addWidget(l, getWidget("csat")!); // 12 wide
      expect(out.items.at(-1)).toMatchObject({ x: 0, y: 7 });
    });

    it("never overlaps what is already there, wherever it lands", () => {
      let l = defaultLayout(ADMIN);
      for (const w of WIDGETS.filter((x) => x.lazy)) l = addWidget(l, w);
      for (let i = 0; i < l.items.length; i++) {
        for (let j = i + 1; j < l.items.length; j++) {
          const a = l.items[i];
          const b = l.items[j];
          const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(hit, `${a.id} overlaps ${b.id}`).toBe(false);
        }
        expect(l.items[i].x + l.items[i].w).toBeLessThanOrEqual(GRID_COLS);
      }
    });

    it("packs half-width widgets side by side instead of one tall column", () => {
      let l = base([]);
      const ids = ["chart.byTechnician", "chart.byCategory", "chart.byType", "chart.age"];
      for (const id of ids) l = addWidget(l, getWidget(id)!);
      const bottom = Math.max(...l.items.map((i) => i.y + i.h));
      const stacked = ids.reduce((sum, id) => sum + getWidget(id)!.size.h, 0);
      expect(bottom).toBeLessThan(stacked * 0.65); // roughly two columns, not one
      expect(new Set(l.items.map((i) => i.x))).toEqual(new Set([0, 6]));
    });
  });

  it("changes a chart type, and clears the choice when set back to the default", () => {
    const base = defaultLayout(ADMIN);
    const pie = setChartType(base, "chart.status", "pie");
    expect(pie.items.find((i) => i.id === "chart.status")!.chart).toBe("pie");
    const back = setChartType(pie, "chart.status", "donut"); // donut is the default
    expect(back.items.find((i) => i.id === "chart.status")!.chart).toBeUndefined();
  });

  it("ignores a chart type the widget does not offer, and non-chart widgets", () => {
    const base = defaultLayout(ADMIN);
    expect(setChartType(base, "chart.trend", "pie")).toBe(base);
    expect(setChartType(base, "stat.total", "bar")).toBe(base);
  });

  it("resolves the type to draw: saved choice, else the widget default, else none", () => {
    const status = getWidget("chart.status")!;
    expect(chartTypeFor(status, undefined)).toBe("donut");
    expect(chartTypeFor(status, { id: "chart.status", x: 0, y: 0, w: 6, h: 7, chart: "hbar" })).toBe("hbar");
    // a stale saved type that is no longer offered falls back to the default
    expect(chartTypeFor(getWidget("chart.trend")!, { id: "chart.trend", x: 0, y: 0, w: 12, h: 7, chart: "pie" })).toBe("line");
    expect(chartTypeFor(getWidget("stat.total")!, undefined)).toBeNull();
    expect(allowedChartTypes(getWidget("stat.total")!)).toEqual([]);
  });

  it("takes positions from the grid without touching chart choices", () => {
    const l = setChartType(defaultLayout(ADMIN), "chart.status", "pie");
    const moved = applyGridPositions(l, [
      { i: "chart.status", x: 3, y: 9, w: 5, h: 6 },
      { i: "ghost", x: 0, y: 0, w: 1, h: 1 },
    ]);
    expect(moved.items.find((i) => i.id === "chart.status")).toMatchObject({
      x: 3, y: 9, w: 5, h: 6, chart: "pie",
    });
    expect(moved.items).toHaveLength(l.items.length);
  });

  it("returns the very same layout when the grid reports nothing moved", () => {
    const l = defaultLayout(ADMIN);
    const same = applyGridPositions(
      l,
      l.items.map((i) => ({ i: i.id, x: i.x, y: i.y, w: i.w, h: i.h })),
    );
    expect(same).toBe(l);
  });

  it("orders a phone's single column top to bottom, left to right", () => {
    const l: DashboardLayout = {
      version: 1,
      items: [
        { id: "stat.open", x: 6, y: 0, w: 2, h: 2 },
        { id: "chart.status", x: 0, y: 4, w: 6, h: 7 },
        { id: "stat.total", x: 0, y: 0, w: 2, h: 2 },
      ],
    };
    expect(stackOrder(l).map((i) => i.id)).toEqual(["stat.total", "stat.open", "chart.status"]);
  });
});

describe("panels fit their content", () => {
  const myQueue = getWidget("myQueue")!;
  const item = (extra = {}) => ({ id: "myQueue" as const, x: 0, y: 0, w: 12, h: 5, ...extra });

  it("applies to the panels only", () => {
    expect(WIDGETS.filter(fitsContent).map((w) => w.id)).toEqual([
      "myQueue", "sla", "escalations", "triage", "planWatch", "csat",
    ]);
  });

  it("counts whole rows, including the gaps between them", () => {
    // 40px rows, 16px gaps: n rows are 56n - 16 px tall
    expect(rowsForHeight(264, 40, 16)).toBe(5);
    expect(rowsForHeight(265, 40, 16)).toBe(6);
    expect(rowsForHeight(1, 40, 16)).toBe(1);
    expect(rowsForHeight(100_000, 40, 16)).toBe(60);
  });

  it("follows the content, taller or shorter than the starting size", () => {
    expect(displayHeight(myQueue, item(), 9)).toBe(9);
    expect(displayHeight(myQueue, item(), 2)).toBe(2);
  });

  it("uses the stored height until measured, and once the person has resized it", () => {
    expect(displayHeight(myQueue, item(), undefined)).toBe(5);
    expect(displayHeight(myQueue, item({ fixedHeight: true }), 9)).toBe(5);
  });

  it("never resizes a chart to its content", () => {
    const chart = getWidget("chart.status")!;
    expect(displayHeight(chart, { id: "chart.status", x: 0, y: 0, w: 6, h: 7 }, 20)).toBe(7);
  });

  it("remembers a chosen height, for panels only, through a save", () => {
    const start = defaultLayout(ADMIN);
    expect(start.items.some((i) => i.fixedHeight)).toBe(false);
    const resized = setFixedHeight(setFixedHeight(start, "sla", 6), "chart.status", 9);
    expect(resized.items.find((i) => i.id === "sla")).toMatchObject({ h: 6, fixedHeight: true });
    expect(resized.items.find((i) => i.id === "chart.status")).toEqual(
      start.items.find((i) => i.id === "chart.status"),
    );
    expect(sanitizeLayout(resized, ADMIN)).toEqual(resized);
  });

  it("drops the flag from a widget that cannot fit its content", () => {
    const forged = { version: 1, items: [{ id: "chart.status", x: 0, y: 0, w: 6, h: 7, fixedHeight: true }] };
    expect(sanitizeLayout(forged, ADMIN)!.items[0]).not.toHaveProperty("fixedHeight");
  });

  it("keeps the flag when the grid reports a move", () => {
    const l = setFixedHeight(defaultLayout(ADMIN), "sla", 6);
    const moved = applyGridPositions(l, [{ i: "sla", x: 0, y: 30, w: 12, h: 6 }]);
    expect(moved.items.find((i) => i.id === "sla")).toMatchObject({ y: 30, fixedHeight: true });
  });
});

describe("tall dashboards", () => {
  it("a dashboard holding every widget is saved exactly where it was arranged", () => {
    const everything = availableWidgets(ADMIN)
      .filter((w) => w.lazy)
      .reduce(addWidget, defaultLayout(ADMIN));
    expect(Math.max(...everything.items.map((i) => i.y))).toBeGreaterThan(60);
    expect(sanitizeLayout(everything, ADMIN)).toEqual(everything);
  });
});

describe("health ring choice", () => {
  it("is offered by the ticket breakdowns, and not where nothing can be overdue", () => {
    const offering = WIDGETS.filter((w) => w.chart?.kind === "tickets");
    expect(offering.map((w) => w.id)).toEqual([
      "chart.byTechnician", "chart.byCategory", "chart.byType",
      "chart.byStream", "chart.byOrganization", "chart.age",
    ]);
    for (const w of offering) expect(allowedChartTypes(w)).toContain("ring");
    for (const id of ["chart.hoursByTechnician", "chart.hoursByBilling", "chart.status", "chart.priority"]) {
      expect(allowedChartTypes(getWidget(id)!)).not.toContain("ring");
    }
  });

  it("survives a save, and is discarded where it is not offered", () => {
    const item = (id: string) => ({ id, x: 0, y: 0, w: 6, h: 7, chart: "ring" });
    const out = sanitizeLayout(
      { version: 1, items: [item("chart.byOrganization"), item("chart.hoursByBilling")] },
      ADMIN,
    )!;
    expect(out.items[0].chart).toBe("ring");
    expect(out.items[1]).not.toHaveProperty("chart");
  });
});
