import { describe, expect, it } from "vitest";
import { fitBarLabels, fitNameAxis, MAX_RING_SLICES, ringSlices, shorten } from "./chart-fit";

const slices = (n: number, extra: { key: string; value: number }[] = []) => [
  ...Array.from({ length: n }, (_, i) => ({ key: `p${i}`, name: `Person ${i}`, value: n - i })),
  ...extra.map((e) => ({ ...e, name: e.key })),
];

describe("shorten", () => {
  it("leaves a name that fits alone", () => {
    expect(shorten("Tech 11", 7)).toBe("Tech 11");
  });

  it("cuts a long one to the limit, ellipsis included", () => {
    expect(shorten("Alexandra Fernandez", 10)).toBe("Alexandra…");
    expect(shorten("Alexandra Fernandez", 10).length).toBeLessThanOrEqual(10);
  });
});

describe("ringSlices", () => {
  it("draws every slice when there are no more than there are colours", () => {
    const data = slices(MAX_RING_SLICES);
    expect(ringSlices(data, "Other")).toBe(data);
  });

  it("keeps the order of a short ordered set (age buckets, statuses)", () => {
    const data = [{ key: "a", name: "a", value: 1 }, { key: "b", name: "b", value: 9 }];
    expect(ringSlices(data, "Other").map((s) => s.key)).toEqual(["a", "b"]);
  });

  it("folds the smallest into one Other, keeping the total", () => {
    const data = slices(13);
    const out = ringSlices(data, "Other");
    expect(out).toHaveLength(MAX_RING_SLICES + 1);
    expect(out.at(-1)).toMatchObject({ key: "other", name: "Other" });
    expect(out.reduce((t, s) => t + s.value, 0)).toBe(data.reduce((t, s) => t + s.value, 0));
  });

  it("adds to an Other the server already made rather than making a second", () => {
    const out = ringSlices(slices(12, [{ key: "other", value: 100 }]), "Other");
    expect(out.filter((s) => s.key === "other")).toHaveLength(1);
    expect(out.at(-1)!.value).toBe(100 + 4 + 3 + 2 + 1);
  });

  it("never folds away Unassigned or No organization", () => {
    const keys = ringSlices(
      slices(12, [{ key: "unassigned", value: 0.5 }, { key: "none", value: 0.5 }]),
      "Other",
    ).map((s) => s.key);
    expect(keys).toContain("unassigned");
    expect(keys).toContain("none");
    expect(keys).toHaveLength(MAX_RING_SLICES + 1);
  });
});

describe("fitBarLabels", () => {
  const people = Array.from({ length: 13 }, (_, i) => `Technician ${i}`);

  it("writes names flat when each has room", () => {
    expect(fitBarLabels(["Low", "High"], 500)).toMatchObject({ angled: false, paddingLeft: 0, showAll: true });
  });

  it("slants them when side by side they would overlap", () => {
    const fit = fitBarLabels(people, 560);
    expect(fit).toMatchObject({ angled: true, showAll: true });
    expect(fit.height).toBeGreaterThan(40);
  });

  it("shortens very long names and leaves room for the first one", () => {
    const fit = fitBarLabels(["An exceptionally long organization name", ...people], 560);
    expect(fit.maxChars).toBe(14);
    expect(fit.paddingLeft).toBeGreaterThan(0);
  });

  it("shortens names further in a short chart, so the bars keep most of it", () => {
    const names = ["Harbourfront Dental Group", ...people];
    const short = fitBarLabels(names, 560, 160);
    expect(short.maxChars).toBeLessThan(fitBarLabels(names, 560, 400).maxChars);
    expect(short.height).toBeLessThanOrEqual(160 * 0.45);
    expect(fitBarLabels(names, 560, 40).maxChars).toBe(5);
  });

  it("leaves the first slanted name room for its whole length", () => {
    const fit = fitBarLabels(people, 560);
    const band = (560 - 36) / people.length;
    // room to its left: margin + narrowest number axis + half a bar
    const room = fit.paddingLeft + 14 + band / 2;
    // a 14-character name drawn at 45°, about 6px a letter plus letter height
    expect(room).toBeGreaterThanOrEqual((fit.maxChars * 6 + 12) * Math.SQRT1_2);
  });

  it("shortens names further in a narrow chart to keep every bar labelled", () => {
    const types = ["Service Request", "Incident", "Problem", "Change", "Question"];
    // tall enough that only the width can be what limits the names
    const fit = fitBarLabels(types, 160, 400);
    expect(fit.showAll).toBe(true);
    expect(fit.maxChars).toBeLessThan(fitBarLabels(types, 360, 400).maxChars);
    expect((160 - 36 - fit.paddingLeft) / types.length).toBeGreaterThanOrEqual(18);
  });

  it("stops labelling every bar when even slanted names would collide", () => {
    expect(fitBarLabels(people, 200).showAll).toBe(false);
  });

  it("copes with no names and an unmeasured chart", () => {
    expect(fitBarLabels([], 0).angled).toBe(false);
    expect(fitBarLabels(people, 0).showAll).toBe(false);
  });
});

describe("fitNameAxis", () => {
  it("is only as wide as the longest name needs", () => {
    const fit = fitNameAxis(["Low", "Medium"], 600);
    expect(fit.width).toBeLessThan(80);
    expect(fit.maxChars).toBeGreaterThanOrEqual("Medium".length);
  });

  it("never takes more than 40% of the chart or 180px", () => {
    const long = ["An exceptionally long organization name"];
    expect(fitNameAxis(long, 300).width).toBe(120);
    expect(fitNameAxis(long, 1200).width).toBe(180);
    expect(fitNameAxis(long, 0).width).toBe(80);
  });
});
