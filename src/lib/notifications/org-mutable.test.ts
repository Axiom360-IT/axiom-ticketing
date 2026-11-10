import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import {
  CUSTOMER_EVENT_TYPES,
  ORG_MUTABLE_EVENTS,
  STAFF_EVENT_TYPES,
  TOGGLEABLE_EVENT_TYPES,
} from "./audience";

describe("per-organization mutable events", () => {
  const all = [...ORG_MUTABLE_EVENTS.customer, ...ORG_MUTABLE_EVENTS.staff];

  it("covers exactly the events a person can tune, so org and person switches line up", () => {
    expect(new Set(all)).toEqual(new Set(TOGGLEABLE_EVENT_TYPES));
    expect(ORG_MUTABLE_EVENTS.customer).toBe(CUSTOMER_EVENT_TYPES);
    expect(ORG_MUTABLE_EVENTS.staff).toBe(STAFF_EVENT_TYPES);
  });

  it("has an admin-facing label for every event (a missing key would render as a raw id)", () => {
    const labels = en.organizations.notifications.events as Record<string, string>;
    for (const e of all) {
      expect(labels[e.replace(/\./g, "__")], e).toBeTruthy();
    }
  });

  it("never lets an admin mute an automation rule (it is the operator's explicit instruction)", () => {
    expect(TOGGLEABLE_EVENT_TYPES.has("automation.rule" as never)).toBe(false);
  });
});
