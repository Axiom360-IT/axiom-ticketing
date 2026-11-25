import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChartSpec } from "@/lib/dashboard/chart-spec";
import type { ChartType } from "@/lib/dashboard/widgets";
import { DashboardChart } from "./charts";

// Recharts sizes itself in the browser, so the chart types that depend on it are
// covered by the browser walkthrough. These cover what renders as plain markup:
// the ring, the number, the text table, and the empty states.
const labels = { empty: "NOTHING", name: "Name", value: "Count", date: "Date", other: "Everyone else", open: "Open", overdue: "Late", health: "Health", onTrack: "Fine", atRisk: "Wobbly", offTrack: "Bad" };
const draw = (spec: ChartSpec, type: ChartType) =>
  renderToStaticMarkup(<DashboardChart spec={spec} type={type} labels={labels} title="Widget" />);

describe("ratio widgets", () => {
  const sla: ChartSpec = { kind: "ratio", value: 0.88, label: "resolved within SLA", detail: "88 of 100 tickets" };

  it("draws a ring with the percentage, a label and an arc sized to the value", () => {
    const html = draw(sla, "ring");
    expect(html).toContain("88%");
    expect(html).toContain("resolved within SLA");
    expect(html).toContain("88 of 100 tickets");
    // circumference 2π·50 ≈ 314.16; 12% of it is left uncovered
    expect(html).toMatch(/stroke-dashoffset="37\.69/);
    expect(html).toContain('aria-label="Widget: resolved within SLA 88%"');
  });

  it("draws a full ring for 100% and an empty one for 0%", () => {
    expect(draw({ ...sla, value: 1 } as ChartSpec, "ring")).toMatch(/stroke-dashoffset="0"/);
    expect(draw({ ...sla, value: 0 } as ChartSpec, "ring")).toMatch(/stroke-dashoffset="314\.15/);
  });

  it("shows the same proportion as a big number", () => {
    const html = draw(sla, "number");
    expect(html).toContain("88%");
    expect(html).not.toContain("<svg");
  });

  it("shows it as a one-row table", () => {
    const html = draw(sla, "table");
    expect(html).toContain("<table");
    expect(html).toContain("resolved within SLA");
    expect(html).toContain("88%");
  });

  it("says there is nothing to show when there is nothing to measure, never 0%", () => {
    const html = draw({ kind: "ratio", value: null, label: "x" }, "ring");
    expect(html).toContain("NOTHING");
    expect(html).not.toContain("0%");
  });
});

describe("tables", () => {
  it("a category table carries the unit with each number", () => {
    const html = draw(
      { kind: "category", palette: "cycle", unit: "h", data: [{ key: "a", name: "Alice", value: 12.5 }, { key: "b", name: "Bob", value: 3 }] },
      "table",
    );
    expect(html).toContain("Alice");
    expect(html).toContain("12.5 h");
    expect(html).toContain("3 h");
  });

  it("a trend table has a column per series and shows a gap as a dash, not a zero", () => {
    const html = draw(
      {
        kind: "trend",
        unit: "h",
        series: [{ key: "hours", name: "Average hours", tone: "amber" }],
        data: [{ date: "Nov 1", hours: 2.5 }, { date: "Nov 2", hours: null }, { date: "Nov 3", hours: 0 }],
      },
      "table",
    );
    expect(html).toContain("Average hours");
    expect(html).toContain("2.5 h");
    expect(html).toContain("—");
    expect(html).toContain("0 h"); // a real zero stays a zero
    expect(html.match(/<tr/g)).toHaveLength(4); // header + 3 days
  });

  it("two series give two value columns", () => {
    const html = draw(
      {
        kind: "trend",
        series: [{ key: "created", name: "Created", tone: "blue" }, { key: "resolved", name: "Resolved", tone: "green" }],
        data: [{ date: "Nov 1", created: 3, resolved: 1 }],
      },
      "table",
    );
    expect(html).toContain("Created");
    expect(html).toContain("Resolved");
  });
});

describe("pie and donut key", () => {
  const people: ChartSpec = {
    kind: "category",
    palette: "cycle",
    data: Array.from({ length: 13 }, (_, i) => ({ key: `p${i}`, name: `Person ${i}`, value: 20 - i })),
  };
  const swatches = (html: string) => [...html.matchAll(/background-color:(#\w+)/g)].map((m) => m[1]);

  it("lists each drawn slice as text, folding the rest into one Other", () => {
    const html = draw(people, "donut");
    expect(html.match(/<li/g)).toHaveLength(9);
    expect(html).toContain("Person 7");
    expect(html).not.toContain("Person 8");
    expect(html).toContain("Everyone else");
  });

  it("gives no two slices the same colour", () => {
    const colours = swatches(draw(people, "pie"));
    expect(new Set(colours).size).toBe(colours.length);
  });

  it("the table still lists every name", () => {
    expect(draw(people, "table")).toContain("Person 12");
  });
});

describe("health ring", () => {
  const orgs = (rows: [string, number, number][]): ChartSpec => ({
    kind: "category",
    palette: "cycle",
    data: rows.map(([name, value, overdue]) => ({ key: name, name, value, overdue })),
  });
  const rowOf = (html: string, name: string) => html.split("<tr").find((r) => r.includes(`>${name}<`))!;

  it("tables every group with its open and overdue counts and its health", () => {
    const html = draw(orgs([["Clinic", 4, 1], ["Registry", 2, 0], ["Board", 3, 2]]), "ring");
    for (const h of ["Open", "Late", "Health"]) expect(html).toContain(`>${h}</th>`);
    expect(rowOf(html, "Clinic")).toMatch(/>4<[\s\S]*>1<[\s\S]*Wobbly/);
    expect(rowOf(html, "Registry")).toMatch(/>2<[\s\S]*>0<[\s\S]*Fine/);
    expect(rowOf(html, "Board")).toMatch(/>3<[\s\S]*>2<[\s\S]*Bad/);
    expect(html).toContain('aria-label="Widget"');
  });

  it("folds many groups into one Other that keeps their overdue count", () => {
    const html = draw(orgs(Array.from({ length: 12 }, (_, i) => [`Org ${i}`, 20 - i, 1] as [string, number, number])), "ring");
    expect(html.match(/<tr/g)).toHaveLength(1 + 8 + 1);
    // the four smallest: 12+11+10+9 open, 4 overdue
    expect(rowOf(html, "Everyone else")).toMatch(/>42<[\s\S]*>4</);
  });

  it("never colours a group red, which means overdue", () => {
    const html = draw(orgs(Array.from({ length: 8 }, (_, i) => [`Org ${i}`, 5, 0] as [string, number, number])), "ring");
    expect(html).not.toMatch(/#(dc2626|ef4444|ec4899)/);
  });

  it("is not the single-percentage ring", () => {
    expect(draw(orgs([["Clinic", 4, 1]]), "ring")).toContain("<table");
  });

  it("says there is nothing to show when no tickets are open", () => {
    expect(draw(orgs([["Clinic", 0, 0]]), "ring")).toContain("NOTHING");
  });
});

describe("empty states", () => {
  it("an all-zero category chart has nothing to draw", () => {
    expect(draw({ kind: "category", palette: "cycle", data: [{ key: "a", name: "A", value: 0 }] }, "bar")).toContain("NOTHING");
  });

  it("a trend with no data on any day has nothing to draw", () => {
    const html = draw(
      { kind: "trend", series: [{ key: "h", name: "H", tone: "blue" }], data: [{ date: "d1", h: null }, { date: "d2", h: null }] },
      "line",
    );
    expect(html).toContain("NOTHING");
  });

  it("but a trend that is genuinely zero is data (an empty backlog is good news)", () => {
    const html = draw(
      { kind: "trend", series: [{ key: "b", name: "B", tone: "blue" }], data: [{ date: "d1", b: 0 }, { date: "d2", b: 0 }] },
      "table",
    );
    expect(html).not.toContain("NOTHING");
    expect(html).toContain("<table");
  });
});
