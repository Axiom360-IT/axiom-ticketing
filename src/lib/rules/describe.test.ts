import { describe, expect, it } from "vitest";
import {
  describeAction,
  describeActions,
  describeCondition,
  describeConditions,
  describeDuration,
  describeRule,
  describeTrigger,
  type RefNames,
} from "./describe";
import {
  defaultSubjectLine,
  placeholderValues,
  PLACEHOLDERS,
  renderMessage,
  renderSms,
  unknownPlaceholders,
} from "./render";
import type { ConditionGroup, FactSheet, RuleAction } from "./types";

// Every assertion here is about what an OPERATOR reads. The engine never sees
// these strings, so the only failure mode is a sentence that misleads
// somebody into writing the wrong rule — which is exactly why it is worth
// testing rather than eyeballing.

const REFS: RefNames = {
  users: { "u-1": "Erwin Rueca", "u-2": "Muhammad Luqman" },
  roles: { "r-1": "IT Director" },
  organizations: { "o-1": "Acme Manufacturing" },
};

describe("describeDuration", () => {
  it("uses the largest unit that stays exact", () => {
    expect(describeDuration(30)).toBe("30 minutes");
    expect(describeDuration(60)).toBe("1 hour");
    expect(describeDuration(120)).toBe("2 hours");
    expect(describeDuration(1440)).toBe("1 day");
    expect(describeDuration(4320)).toBe("3 days");
  });

  it("never rounds a threshold away", () => {
    // A card saying "2 hours" beside an engine using 90 minutes would have
    // an operator debugging the wrong number.
    expect(describeDuration(90)).toBe("1 hour 30 minutes");
    expect(describeDuration(1)).toBe("1 minute");
  });

  it("survives nonsense rather than printing NaN at someone", () => {
    expect(describeDuration(0)).toBe("no time at all");
    expect(describeDuration(-5)).toBe("an unknown time");
    expect(describeDuration(Number.NaN)).toBe("an unknown time");
  });
});

describe("describeTrigger", () => {
  it("reads as a sentence opening", () => {
    expect(describeTrigger({ kind: "event", event: "ticket.created" })).toBe(
      "When a ticket is raised",
    );
    expect(
      describeTrigger({ kind: "state", state: "unassigned_for", minutes: 30 }),
    ).toBe("When a ticket has had no owner for 30 minutes");
  });

  it("says 'every weekday' rather than naming five days", () => {
    expect(
      describeTrigger({
        kind: "schedule",
        hour: 19,
        minute: 0,
        weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
      }),
    ).toBe("every weekday at 19:00");
  });

  it("says 'every day' for all seven", () => {
    expect(
      describeTrigger({
        kind: "schedule",
        hour: 8,
        minute: 5,
        weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      }),
    ).toBe("every day at 08:05");
  });

  it("names the days when it is an odd set", () => {
    expect(
      describeTrigger({
        kind: "schedule",
        hour: 9,
        minute: 0,
        weekdays: ["Sat", "Sun"],
      }),
    ).toBe("Saturday, Sunday at 09:00");
  });
});

describe("describeCondition", () => {
  it("renders enum values in English, not as stored", () => {
    expect(
      describeCondition({ field: "status", operator: "is", value: "in_progress" }),
    ).toBe("status is In progress");
    expect(
      describeCondition({ field: "billable", operator: "is", value: "hourly_premium" }),
    ).toBe("billing type is Hourly — premium rate");
  });

  it("resolves a reference to its name", () => {
    expect(
      describeCondition({ field: "organization", operator: "is", value: "o-1" }, REFS),
    ).toBe("the client is Acme Manufacturing");
  });

  it("says a referent is GONE rather than printing a uuid", () => {
    expect(
      describeCondition({ field: "assignee", operator: "is", value: "u-99" }, REFS),
    ).toContain("no longer exists");
  });

  it("phrases a boolean as a statement, not as 'is yes'", () => {
    expect(
      describeCondition({ field: "is_escalated", operator: "is", value: true }),
    ).toBe("it is escalated");
    expect(
      describeCondition({ field: "is_escalated", operator: "is", value: false }),
    ).toBe("not it is escalated");
  });

  it("drops the value box for a unary operator", () => {
    expect(describeCondition({ field: "assignee", operator: "is_empty" })).toBe(
      "the owner is empty",
    );
  });

  it("renders a list as 'a, b or c'", () => {
    expect(
      describeCondition({
        field: "priority",
        operator: "is_one_of",
        value: ["high", "critical"],
      }),
    ).toBe("priority is any of High or Critical");
  });

  it("renders a duration field as a duration", () => {
    expect(
      describeCondition({ field: "age_minutes", operator: "gte", value: 120 }),
    ).toBe("the ticket's age is at least 2 hours");
  });

  it("flags a field that no longer exists", () => {
    expect(
      describeCondition({ field: "moon_phase", operator: "is", value: "waxing" }),
    ).toContain("unknown setting");
  });
});

describe("describeConditions", () => {
  it("joins with and / or", () => {
    const tree: ConditionGroup = {
      combinator: "all",
      conditions: [
        { field: "priority", operator: "is", value: "critical" },
        { field: "assignee", operator: "is_empty" },
      ],
    };
    expect(describeConditions(tree)).toBe(
      "priority is Critical and the owner is empty",
    );
  });

  it("brackets a nested group so the logic is unambiguous", () => {
    const tree: ConditionGroup = {
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
    };
    expect(describeConditions(tree)).toBe(
      "status is Open and (priority is Critical or times reopened is at least 2)",
    );
  });

  it("says nothing at all when there are no conditions", () => {
    expect(describeConditions({ combinator: "all", conditions: [] })).toBe("");
  });
});

describe("describeAction", () => {
  it("names the people and the channels", () => {
    const action: RuleAction = {
      type: "notify",
      channels: ["sms", "email"],
      audiences: ["named_users"],
      userIds: ["u-1", "u-2"],
      body: "hi",
    };
    expect(describeAction(action, REFS)).toBe(
      "tell Erwin Rueca and Muhammad Luqman by text and by email",
    );
  });

  it("warns rather than lying when nobody is chosen", () => {
    expect(
      describeAction(
        {
          type: "notify",
          channels: ["email"],
          audiences: ["named_users"],
          userIds: [],
          body: "hi",
        },
        REFS,
      ),
    ).toContain("nobody chosen");
  });

  it("describes the standing audiences without needing names", () => {
    expect(
      describeAction({
        type: "notify",
        channels: ["in_app"],
        audiences: ["assignee"],
        body: "hi",
      }),
    ).toBe("tell whoever owns it in the app");
  });

  it("is honest that flagging tells nobody", () => {
    expect(describeAction({ type: "flag", reason: "needs a look" })).toContain(
      "without telling anyone",
    );
  });
});

describe("describeActions", () => {
  it("joins several with a trailing 'then'", () => {
    expect(
      describeActions([
        { type: "internal_note", body: "x" },
        { type: "flag", reason: "y" },
      ]),
    ).toBe('post an internal note, then record it as "y", without telling anyone');
  });

  it("says so when a rule does nothing", () => {
    expect(describeActions([])).toBe("do nothing");
  });
});

describe("describeRule", () => {
  it("reads as one sentence an operator could have written", () => {
    expect(
      describeRule(
        {
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
              roles: ["r-1"],
              body: "x",
            },
          ],
        },
        REFS,
      ),
    ).toBe(
      "When a ticket has had no owner for 30 minutes, and priority is Critical, tell everyone who is IT Director by text.",
    );
  });

  it("drops the middle clause when there are no conditions", () => {
    expect(
      describeRule({
        trigger: { kind: "event", event: "ticket.created" },
        conditions: { combinator: "all", conditions: [] },
        actions: [{ type: "flag", reason: "new" }],
      }),
    ).toBe('When a ticket is raised, record it as "new", without telling anyone.');
  });
});

// ── render.ts ─────────────────────────────────────────────────────────

const facts: FactSheet = {
  ticket: {
    id: "t1",
    ticketNumber: "AX-0042",
    subject: "Printer on fire",
    description: "d",
    category: "hardware",
    type: "incident",
    serviceType: "onsite",
    priority: "critical",
    status: "open",
    stream: "external",
    origin: "email",
    createdVia: "direct_email",
    organizationId: "o-1",
    customerEmail: "jo@acme.com",
    customerDomain: "acme.com",
    orgMatchStatus: "domain",
    billable: null,
    invoiceNumber: null,
    assignedToId: null,
    isEscalated: false,
    escalationReason: null,
    escalationTargetRole: null,
    csatRating: null,
    reopenedCount: 2,
    firstResponseAt: null,
    resolutionDueAt: null,
    slaBreachedAt: null,
    slaPausedAt: null,
    resolvedAt: null,
    createdAt: new Date("2026-10-07T09:00:00Z"),
    updatedAt: new Date("2026-10-07T09:00:00Z"),
  },
  organization: {
    id: "o-1",
    name: "Acme Manufacturing",
    isInternal: false,
    isMonthlyPlan: true,
    monthlyMinutesBalance: 45,
  },
  assignee: null,
  counts: { participants: 0, publicMessages: 1, attachments: 0, workLogMinutes: 0 },
  timing: {
    ageMinutes: 125,
    minutesInStatus: 125,
    minutesSinceLastCustomerMessage: null,
    minutesSinceLastAgentMessage: null,
    minutesSinceAssigned: null,
    minutesPastResolutionDue: null,
  },
  local: {
    weekday: "Wed",
    hour: 11,
    minute: 5,
    insideBusinessHours: true,
    isHoliday: false,
  },
};

const ctx = {
  facts,
  assigneeName: null,
  customerName: "Jo Bloggs",
  ruleName: "Chase abandoned criticals",
  url: "https://support.axiom360.it/admin/tickets/t1",
};

describe("renderMessage", () => {
  it("substitutes the placeholders an operator would reach for", () => {
    expect(
      renderMessage("{ticketNumber} ({priority}) at {organizationName}", ctx),
    ).toBe("AX-0042 (critical) at Acme Manufacturing");
  });

  it("leaves an unknown token VISIBLE rather than blanking it", () => {
    // "{tikcetNumber} needs attention" must read as an obvious typo, not as a
    // mysteriously empty sentence.
    expect(renderMessage("{tikcetNumber} needs attention", ctx)).toBe(
      "{tikcetNumber} needs attention",
    );
  });

  it("has a value for every declared placeholder", () => {
    const values = placeholderValues(ctx);
    for (const p of PLACEHOLDERS) {
      expect(typeof values[p], `${p} is missing`).toBe("string");
    }
  });

  it("says 'nobody' rather than nothing for an unassigned ticket", () => {
    expect(renderMessage("owner: {assigneeName}", ctx)).toBe("owner: nobody");
  });

  it("renders ages as English, not as minutes", () => {
    expect(renderMessage("{ageHours}", ctx)).toBe("2 hours");
  });

  it("does not expand anything recursively", () => {
    // Defence against a message that constructs another token.
    expect(renderMessage("{subject}", { ...ctx, facts })).toBe("Printer on fire");
  });
});

describe("unknownPlaceholders", () => {
  it("finds typos so the builder can warn before saving", () => {
    expect(unknownPlaceholders("{ticketNumber} {nope} {alsoNope}")).toEqual([
      "nope",
      "alsoNope",
    ]);
  });

  it("is quiet when everything is known", () => {
    expect(unknownPlaceholders("{ticketNumber} {priority}")).toEqual([]);
  });
});

describe("renderSms", () => {
  it("keeps the whole message when it fits", () => {
    expect(renderSms("short", "https://x.co/1")).toBe("short https://x.co/1");
  });

  it("protects the LINK and truncates the words", () => {
    // A text saying "AX-0042 needs attenti…" with no way to act on it is
    // worse than a shorter sentence that still links.
    const url = "https://support.axiom360.it/admin/tickets/abcdef";
    const out = renderSms("x".repeat(300), url);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith(url)).toBe(true);
    expect(out).toContain("…");
  });

  it("uses the whole budget when there is no link", () => {
    const out = renderSms("y".repeat(300));
    expect(out.length).toBe(160);
  });
});

describe("defaultSubjectLine", () => {
  it("leads with the ticket number", () => {
    expect(defaultSubjectLine(ctx)).toBe("AX-0042 — Printer on fire");
  });
});
