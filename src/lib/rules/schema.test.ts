import { describe, expect, it } from "vitest";
import {
  actionCost,
  hasMutatingAction,
  parseStoredRule,
  ruleInputSchema,
} from "./schema";
import type { RuleInput } from "./schema";

// Validation is the last point at which a bad rule is cheap to stop. After
// this it becomes a row that looks fine on the page and silently never
// matches — the hardest failure in the whole feature to diagnose.

const valid: RuleInput = {
  name: "Chase abandoned criticals",
  trigger: { kind: "state", state: "unassigned_for", minutes: 30 },
  conditions: {
    combinator: "all",
    conditions: [{ field: "priority", operator: "is", value: "critical" }],
  },
  actions: [
    {
      type: "notify",
      channels: ["sms"],
      audiences: ["named_roles"],
      roles: ["IT Director"],
      body: "{ticketNumber} has no owner.",
    },
  ],
  dedupe: { policy: "once_per_occurrence" },
};

const parse = (input: unknown) => ruleInputSchema.safeParse(input);
const firstError = (input: unknown): string => {
  const r = parse(input);
  if (r.success) throw new Error("expected this to be rejected");
  return r.error.issues[0]?.message ?? "";
};

describe("ruleInputSchema", () => {
  it("accepts a realistic rule", () => {
    const r = parse(valid);
    expect(r.success).toBe(true);
  });

  it("fills the safe defaults", () => {
    const r = parse(valid);
    if (!r.success) throw new Error("expected success");
    // Every one of these defaults OFF for a reason — chaining is the loop
    // guard, applyToExisting is the cold-start guard.
    expect(r.data.stopOnMatch).toBe(false);
    expect(r.data.allowChaining).toBe(false);
    expect(r.data.applyToExisting).toBe(false);
    expect(r.data.order).toBe(100);
  });

  describe("conditions", () => {
    it("rejects a field that does not exist", () => {
      expect(
        firstError({
          ...valid,
          conditions: {
            combinator: "all",
            conditions: [{ field: "moon_phase", operator: "is", value: "full" }],
          },
        }),
      ).toContain("no setting called");
    });

    it("rejects an operator the field cannot use", () => {
      expect(
        firstError({
          ...valid,
          conditions: {
            combinator: "all",
            conditions: [{ field: "priority", operator: "gt", value: 3 }],
          },
        }),
      ).toContain("cannot be used");
    });

    it("rejects an enum value the COLUMN would reject", () => {
      // This is the one that matters most: "urgent" is not a priority, so
      // the rule would save cleanly and then never match anything, forever.
      expect(
        firstError({
          ...valid,
          conditions: {
            combinator: "all",
            conditions: [{ field: "priority", operator: "is", value: "urgent" }],
          },
        }),
      ).toContain("not a valid priority");
    });

    it("rejects a missing value on a binary operator", () => {
      expect(
        firstError({
          ...valid,
          conditions: {
            combinator: "all",
            conditions: [{ field: "priority", operator: "is" }],
          },
        }),
      ).toContain("needs a value");
    });

    it("allows a unary operator with no value", () => {
      expect(
        parse({
          ...valid,
          conditions: {
            combinator: "all",
            conditions: [{ field: "assignee", operator: "is_empty" }],
          },
        }).success,
      ).toBe(true);
    });

    it("requires a non-empty list for a list operator", () => {
      expect(
        firstError({
          ...valid,
          conditions: {
            combinator: "all",
            conditions: [{ field: "priority", operator: "is_one_of", value: [] }],
          },
        }),
      ).toContain("at least one value");
    });

    it("requires a number where a number is meant", () => {
      expect(
        firstError({
          ...valid,
          conditions: {
            combinator: "all",
            conditions: [{ field: "age_minutes", operator: "gte", value: "soon" }],
          },
        }),
      ).toContain("needs a number");
    });

    it("accepts an empty tree — that means 'no exceptions'", () => {
      expect(
        parse({ ...valid, conditions: { combinator: "all", conditions: [] } })
          .success,
      ).toBe(true);
    });

    it("accepts one level of nesting", () => {
      expect(
        parse({
          ...valid,
          conditions: {
            combinator: "all",
            conditions: [
              { field: "status", operator: "is", value: "open" },
              {
                combinator: "any",
                conditions: [
                  { field: "priority", operator: "is", value: "critical" },
                  { field: "reopened_count", operator: "gte", value: 2 },
                ],
              },
            ],
          },
        }).success,
      ).toBe(true);
    });
  });

  describe("actions", () => {
    it("requires at least one", () => {
      expect(parse({ ...valid, actions: [] }).success).toBe(false);
    });

    it("rejects an audience with nobody behind it", () => {
      // Picking "chosen people" and choosing none sends to nobody and says
      // nothing about why.
      expect(
        firstError({
          ...valid,
          actions: [
            {
              type: "notify",
              channels: ["email"],
              audiences: ["named_users"],
              userIds: [],
              body: "x",
            },
          ],
        }),
      ).toContain("chose none");
    });

    it("requires at least one channel", () => {
      expect(
        parse({
          ...valid,
          actions: [
            { type: "notify", channels: [], audiences: ["assignee"], body: "x" },
          ],
        }).success,
      ).toBe(false);
    });

    it("refuses a plaintext webhook", () => {
      // The payload carries ticket content off this system.
      expect(
        parse({
          ...valid,
          actions: [{ type: "webhook", url: "http://example.com/hook" }],
        }).success,
      ).toBe(false);
      expect(
        parse({
          ...valid,
          actions: [{ type: "webhook", url: "https://example.com/hook" }],
        }).success,
      ).toBe(true);
    });
  });

  describe("trigger and dedupe have to agree", () => {
    it("refuses a state rule that repeats every time it checks", () => {
      // The scanner runs every ten minutes: `always` means six alerts an
      // hour, forever, for one waiting ticket.
      expect(
        firstError({ ...valid, dedupe: { policy: "always" } }),
      ).toContain("must not repeat every time it checks");
    });

    it("accepts any policy on a clock rule", () => {
      // A schedule rule evaluates each open ticket when its time comes, so
      // per-ticket policies are meaningful on it.
      for (const policy of ["always", "once_per_occurrence", "once_per_ticket"]) {
        expect(
          parse({
            ...valid,
            trigger: { kind: "schedule", hour: 8, minute: 0, weekdays: ["Mon"] },
            dedupe: { policy },
          }).success,
          policy,
        ).toBe(true);
      }
    });

    it("requires an interval for a throttle", () => {
      expect(
        firstError({ ...valid, dedupe: { policy: "throttle" } }),
      ).toContain("how often");
    });

    it("rejects an impossible schedule", () => {
      for (const bad of [
        { kind: "schedule", hour: 24, minute: 0, weekdays: ["Mon"] },
        { kind: "schedule", hour: 8, minute: 60, weekdays: ["Mon"] },
        { kind: "schedule", hour: 8, minute: 0, weekdays: [] },
        { kind: "schedule", hour: 8, minute: 0, weekdays: ["Funday"] },
      ]) {
        expect(parse({ ...valid, trigger: bad }).success).toBe(false);
      }
    });
  });
});

describe("parseStoredRule", () => {
  it("reads back what the schema accepted", () => {
    const r = parseStoredRule({
      trigger: valid.trigger,
      conditions: valid.conditions,
      actions: valid.actions,
    });
    expect(r.ok).toBe(true);
  });

  it("returns a REASON rather than throwing on a field that was removed", () => {
    // One unparseable row must not stop the other forty rules running.
    const r = parseStoredRule({
      trigger: valid.trigger,
      conditions: {
        combinator: "all",
        conditions: [{ field: "a_field_we_deleted", operator: "is", value: "x" }],
      },
      actions: valid.actions,
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.reason).toContain("a_field_we_deleted");
  });

  it("refuses a rule with no actions left", () => {
    const r = parseStoredRule({
      trigger: valid.trigger,
      conditions: valid.conditions,
      actions: [],
    });
    expect(r.ok).toBe(false);
  });

  it("refuses garbage without throwing", () => {
    for (const junk of [null, 42, "nope", {}, []]) {
      const r = parseStoredRule({
        trigger: junk,
        conditions: junk,
        actions: junk,
      });
      expect(r.ok).toBe(false);
    }
  });
});

describe("hasMutatingAction", () => {
  it("spots an action that would change a ticket", () => {
    expect(hasMutatingAction([{ type: "flag", reason: "x" }])).toBe(false);
    expect(hasMutatingAction([{ type: "set_priority", value: "high" }])).toBe(true);
    expect(
      hasMutatingAction([
        { type: "flag", reason: "x" },
        { type: "close" },
      ]),
    ).toBe(true);
  });
});

describe("actionCost", () => {
  it("weighs a notification above a note", () => {
    // The hourly budget is weighted so a rule cannot send 200 texts while
    // technically staying under a 200-"action" cap.
    const note = actionCost([{ type: "internal_note", body: "x" }]);
    const notify = actionCost([
      {
        type: "notify",
        channels: ["sms"],
        audiences: ["assignee"],
        body: "x",
      },
    ]);
    expect(notify).toBeGreaterThan(note);
  });

  it("adds up across the actions of one rule", () => {
    expect(
      actionCost([
        { type: "internal_note", body: "x" },
        { type: "flag", reason: "y" },
      ]),
    ).toBe(2);
  });

  it("is zero for a rule with no actions", () => {
    expect(actionCost([])).toBe(0);
  });
});
