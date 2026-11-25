import { describe, expect, it } from "vitest";
import messages from "@/messages/en.json";
import { AGE_BUCKETS } from "./metrics";
import { CHART_TYPES, WIDGETS } from "./widgets";

// The widget loader asks next-intl for these keys at runtime, and a missing key
// shows the raw key path to a user instead of failing loudly. So every key the
// code can ask for is checked here against the message file.
const at = (...path: string[]): unknown =>
  path.reduce<unknown>(
    (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
    messages.admin.landing,
  );
const has = (...path: string[]) => typeof at(...path) === "string" && at(...path) !== "";

describe("dashboard messages", () => {
  it("every on-demand widget has a title and a subtitle", () => {
    for (const w of WIDGETS.filter((x) => x.lazy)) {
      expect(has("metrics", w.metricKey!, "title"), `${w.id} title`).toBe(true);
      expect(has("metrics", w.metricKey!, "subtitle"), `${w.id} subtitle`).toBe(true);
    }
  });

  it("the series, label and detail strings the loader uses exist", () => {
    for (const k of ["backlog", "firstResponse", "resolutionTime", "csatTrend"]) {
      expect(has("metrics", k, "series"), k).toBe(true);
    }
    for (const k of ["sla", "escalation"]) {
      expect(has("metrics", k, "label"), k).toBe(true);
      expect(has("metrics", k, "detail"), k).toBe(true);
    }
  });

  it("covers every age bucket, stream and billing category, and the fallback names", () => {
    for (const b of AGE_BUCKETS) expect(has("metrics", "age", b), b).toBe(true);
    for (const s of ["internal", "external"]) expect(has("metrics", "stream", s), s).toBe(true);
    for (const b of ["hourly_regular", "hourly_premium", "no", "monthly_plan", "project", "rework", "unset"]) {
      expect(has("metrics", "billing", b), b).toBe(true);
    }
    for (const k of ["unassigned", "other", "noOrganization", "unknownTechnician"]) {
      expect(has("metrics", k), k).toBe(true);
    }
  });

  it("has every word the charts and the ring table use", () => {
    for (const k of ["empty", "name", "value", "date", "open", "overdue", "health", "onTrack", "atRisk", "offTrack"]) {
      expect(has("chart", k), k).toBe(true);
    }
  });

  it("has a message for every way saving can fail", () => {
    for (const k of ["saveInvalid", "saveUnavailable", "saveOffline"]) {
      expect(has("customize", k), k).toBe(true);
    }
  });

  it("names every chart type and widget group in the picker", () => {
    for (const t of CHART_TYPES) expect(has("customize", "chartType", t), t).toBe(true);
    for (const g of ["stats", "charts", "panels"]) expect(has("customize", "group", g), g).toBe(true);
  });

  it("every message uses only the placeholders its widget supplies", () => {
    const allowed: Record<string, string[]> = {
      byOrganization: ["n"], backlog: ["days"], firstResponse: ["days"], resolutionTime: ["days"],
      csatTrend: ["months"], sla: ["days", "met", "total"], escalation: ["days", "escalated", "total"],
      hoursByTechnician: ["days"], hoursByBilling: ["days"],
    };
    const metrics = at("metrics") as Record<string, unknown>;
    for (const [key, entry] of Object.entries(metrics)) {
      if (!entry || typeof entry !== "object") continue;
      for (const field of ["subtitle", "detail"]) {
        const text = (entry as Record<string, unknown>)[field];
        if (typeof text !== "string") continue;
        for (const [, name] of text.matchAll(/\{(\w+)\}/g)) {
          expect(allowed[key] ?? [], `${key}.${field} uses {${name}}`).toContain(name);
        }
      }
    }
  });
});
