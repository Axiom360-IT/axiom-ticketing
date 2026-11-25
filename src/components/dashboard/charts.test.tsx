import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChartSpec } from "@/lib/dashboard/chart-spec";
import type { ChartType } from "@/lib/dashboard/widgets";
import { DashboardChart } from "./charts";

// Recharts sizes itself in the browser, so the chart types that depend on it are
// covered by the browser walkthrough. These cover what renders as plain markup:
// the ring, the number, the text table, and the empty states.
const labels = { empty: "NOTHING", name: "Name", value: "Count", date: "Date" };
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
