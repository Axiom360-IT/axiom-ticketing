import { describe, expect, it } from "vitest";
import { type ChangeDiff, compare, evaluate, eventsFromDiff } from "./evaluate";
import type { ConditionGroup, FactSheet } from "./types";

// ── A FactSheet with sane defaults, overridable per test ──────────────
//
// Every test states only the facts it cares about. A test that passes because
// of an unstated default is a test that will lie later.

const BASE_CREATED = new Date("2026-10-01T09:00:00Z");

function facts(over: {
  ticket?: Partial<FactSheet["ticket"]>;
  organization?: FactSheet["organization"];
  assignee?: FactSheet["assignee"];
  counts?: Partial<FactSheet["counts"]>;
  timing?: Partial<FactSheet["timing"]>;
  local?: Partial<FactSheet["local"]>;
} = {}): FactSheet {
  return {
    ticket: {
      id: "t1",
      ticketNumber: "AX-0001",
      subject: "Printer is on fire",
      description: "The big one by the lift",
      category: "hardware",
      type: "incident",
      serviceType: "onsite",
      priority: "medium",
      status: "open",
      stream: "external",
      origin: "email",
      createdVia: "direct_email",
      organizationId: "org1",
      customerEmail: "Jo@Acme.COM",
      customerDomain: null,
      orgMatchStatus: "domain",
      billable: null,
      invoiceNumber: null,
      assignedToId: null,
      isEscalated: false,
      escalationReason: null,
      escalationTargetRole: null,
      csatRating: null,
      reopenedCount: 0,
      firstResponseAt: null,
      resolutionDueAt: null,
      slaBreachedAt: null,
      slaPausedAt: null,
      resolvedAt: null,
      createdAt: BASE_CREATED,
      updatedAt: BASE_CREATED,
      ...over.ticket,
    },
    organization: over.organization ?? null,
    assignee: over.assignee ?? null,
    counts: {
      participants: 0,
      publicMessages: 0,
      attachments: 0,
      workLogMinutes: 0,
      ...over.counts,
    },
    timing: {
      ageMinutes: 10,
      minutesInStatus: 10,
      minutesSinceLastCustomerMessage: null,
      minutesSinceLastAgentMessage: null,
      minutesSinceAssigned: null,
      minutesPastResolutionDue: null,
      ...over.timing,
    },
    local: {
      weekday: "Thu",
      hour: 11,
      minute: 0,
      insideBusinessHours: true,
      isHoliday: false,
      ...over.local,
    },
  };
}

const all = (...conditions: ConditionGroup["conditions"]): ConditionGroup => ({
  combinator: "all",
  conditions,
});
const any = (...conditions: ConditionGroup["conditions"]): ConditionGroup => ({
  combinator: "any",
  conditions,
});

// ── compare() ─────────────────────────────────────────────────────────

describe("compare", () => {
  it("matches enums case-insensitively", () => {
    expect(compare("critical", "is", "Critical", false)).toBe(true);
    expect(compare("critical", "is_not", "low", false)).toBe(true);
  });

  it("treats is_one_of as membership", () => {
    expect(compare("high", "is_one_of", ["high", "critical"], false)).toBe(true);
    expect(compare("low", "is_one_of", ["high", "critical"], false)).toBe(false);
    expect(compare("low", "is_not_one_of", ["high", "critical"], false)).toBe(true);
  });

  it("calls null, undefined, empty string and [] empty", () => {
    for (const v of [null, "", [] as string[]]) {
      expect(compare(v, "is_empty", undefined, false)).toBe(true);
      expect(compare(v, "is_not_empty", undefined, false)).toBe(false);
    }
    expect(compare("x", "is_empty", undefined, false)).toBe(false);
  });

  it("does substring matching case-insensitively", () => {
    expect(compare("Printer on FIRE", "contains", "fire", false)).toBe(true);
    expect(compare("Printer on fire", "not_contains", "flood", false)).toBe(true);
  });

  it("treats contains-nothing as vacuously true and not_contains-nothing too", () => {
    // An operator who leaves the box blank should not accidentally match
    // everything on `contains`.
    expect(compare("anything", "contains", "", false)).toBe(false);
    expect(compare("anything", "not_contains", "", false)).toBe(true);
  });

  it("compares numbers, including numeric strings", () => {
    expect(compare(90, "gte", 60, false)).toBe(true);
    expect(compare(30, "gte", 60, false)).toBe(false);
    expect(compare("90", "gt", "60", false)).toBe(true);
    expect(compare(60, "lte", 60, false)).toBe(true);
  });

  it("NEVER satisfies a numeric comparison from a missing fact", () => {
    // The whole null policy. A ticket the customer has never written on has
    // no "minutes since their last message" — treating that as 0 or Infinity
    // would both be confidently wrong.
    for (const op of ["gt", "gte", "lt", "lte"] as const) {
      expect(compare(null, op, 60, false)).toBe(false);
    }
  });

  it("refuses a non-numeric value rather than coercing it to 0", () => {
    expect(compare(5, "gt", "banana", false)).toBe(false);
    expect(compare(5, "lt", "banana", false)).toBe(false);
  });

  it("handles booleans, including the string 'true' a form round-trip leaves", () => {
    expect(compare(true, "is", true, false)).toBe(true);
    expect(compare(true, "is", "true", false)).toBe(true);
    expect(compare(false, "is", false, false)).toBe(true);
    expect(compare(true, "is", false, false)).toBe(false);
  });

  it("treats a set-valued fact as membership", () => {
    const roles = ["Technician", "Coordinator"];
    expect(compare(roles, "is", "coordinator", true)).toBe(true);
    expect(compare(roles, "is", "IT Director", true)).toBe(false);
    expect(compare(roles, "is_one_of", ["IT Director", "Technician"], true)).toBe(true);
    expect(compare(roles, "is_not", "IT Director", true)).toBe(true);
    expect(compare(roles, "is_not_one_of", ["Technician"], true)).toBe(false);
    expect(compare([], "is", "Technician", true)).toBe(false);
  });
});

// ── evaluate() ────────────────────────────────────────────────────────

describe("evaluate", () => {
  it("matches an empty condition tree", () => {
    // "Whenever this happens, no exceptions."
    expect(evaluate(all(), facts()).matches).toBe(true);
  });

  it("requires every condition under all", () => {
    const tree = all(
      { field: "priority", operator: "is", value: "critical" },
      { field: "status", operator: "is", value: "open" },
    );
    expect(evaluate(tree, facts({ ticket: { priority: "critical" } })).matches).toBe(
      true,
    );
    expect(evaluate(tree, facts({ ticket: { priority: "low" } })).matches).toBe(false);
  });

  it("requires one condition under any", () => {
    const tree = any(
      { field: "priority", operator: "is", value: "critical" },
      { field: "is_escalated", operator: "is", value: true },
    );
    expect(evaluate(tree, facts({ ticket: { isEscalated: true } })).matches).toBe(true);
    expect(evaluate(tree, facts()).matches).toBe(false);
  });

  it("nests a group inside a group", () => {
    const tree = all(
      { field: "status", operator: "is", value: "open" },
      any(
        { field: "priority", operator: "is", value: "critical" },
        { field: "reopened_count", operator: "gte", value: 2 },
      ),
    );
    expect(evaluate(tree, facts({ ticket: { reopenedCount: 3 } })).matches).toBe(true);
    expect(evaluate(tree, facts({ ticket: { reopenedCount: 1 } })).matches).toBe(false);
  });

  it("says which condition failed, and where", () => {
    const tree = all(
      { field: "status", operator: "is", value: "open" },
      { field: "priority", operator: "is", value: "critical" },
    );
    const d = evaluate(tree, facts());
    expect(d.matches).toBe(false);
    if (d.matches) throw new Error("expected no match");
    // The index is what the "why didn't it fire?" log points the operator at.
    expect(d.failedAt).toBe("root.1");
    expect(d.reason).toContain("priority");
    expect(d.reason).toContain("medium");
  });

  it("fails CLOSED on a field that no longer exists", () => {
    // A rule saved before a rename must not start matching everything.
    const d = evaluate(
      all({ field: "colour_of_the_sky", operator: "is", value: "blue" }),
      facts(),
    );
    expect(d.matches).toBe(false);
    if (d.matches) throw new Error("expected no match");
    expect(d.reason).toContain("unknown field");
  });

  it("fails closed on an operator the field does not allow", () => {
    const d = evaluate(
      all({ field: "priority", operator: "gt", value: 3 }),
      facts(),
    );
    expect(d.matches).toBe(false);
  });

  it("fails closed when a non-unary condition has no value", () => {
    const d = evaluate(all({ field: "priority", operator: "is" }), facts());
    expect(d.matches).toBe(false);
    if (d.matches) throw new Error("expected no match");
    expect(d.reason).toContain("no value");
  });

  it("reads through to the organization and the assignee", () => {
    const f = facts({
      organization: {
        id: "org1",
        name: "Acme",
        isInternal: false,
        isMonthlyPlan: true,
        monthlyMinutesBalance: 45,
      },
      assignee: { id: "u1", roleNames: ["Technician"], isActive: true },
      ticket: { assignedToId: "u1" },
    });
    expect(
      evaluate(
        all(
          { field: "org_monthly_balance_minutes", operator: "lt", value: 60 },
          { field: "assignee_role", operator: "is", value: "Technician" },
          { field: "org_is_internal", operator: "is", value: false },
        ),
        f,
      ).matches,
    ).toBe(true);
  });

  it("derives the customer domain when it is not denormalized", () => {
    expect(
      evaluate(
        all({ field: "customer_domain", operator: "is", value: "acme.com" }),
        facts(),
      ).matches,
    ).toBe(true);
  });

  it("finds an unassigned ticket with is_empty, not with is null", () => {
    expect(
      evaluate(all({ field: "assignee", operator: "is_empty" }), facts()).matches,
    ).toBe(true);
    expect(
      evaluate(
        all({ field: "assignee", operator: "is_not_empty" }),
        facts({ ticket: { assignedToId: "u1" } }),
      ).matches,
    ).toBe(true);
  });

  describe("sla_state", () => {
    const due = (minutesTotal: number) =>
      new Date(BASE_CREATED.getTime() + minutesTotal * 60_000);

    it("is paused when the clock is stopped, even after a breach", () => {
      const f = facts({
        ticket: { slaPausedAt: new Date(), slaBreachedAt: new Date() },
      });
      expect(
        evaluate(all({ field: "sla_state", operator: "is", value: "paused" }), f)
          .matches,
      ).toBe(true);
    });

    it("is breached once the stamp is set", () => {
      const f = facts({ ticket: { slaBreachedAt: new Date() } });
      expect(
        evaluate(all({ field: "sla_state", operator: "is", value: "breached" }), f)
          .matches,
      ).toBe(true);
    });

    it("steps through ok → 50 → 80 as the window elapses", () => {
      const check = (ageMinutes: number, expected: string) => {
        const f = facts({
          ticket: { resolutionDueAt: due(100) },
          timing: { ageMinutes },
        });
        expect(
          evaluate(all({ field: "sla_state", operator: "is", value: expected }), f)
            .matches,
        ).toBe(true);
      };
      check(10, "ok");
      check(55, "warning_50");
      check(85, "warning_80");
    });

    it("is ok when there is no resolution target at all", () => {
      expect(
        evaluate(
          all({ field: "sla_state", operator: "is", value: "ok" }),
          facts(),
        ).matches,
      ).toBe(true);
    });
  });
});

// ── eventsFromDiff() ──────────────────────────────────────────────────

const diff = (changed: ChangeDiff["changed"]): ChangeDiff => ({
  op: "update",
  changed,
});

describe("eventsFromDiff", () => {
  it("maps an insert to created and nothing else", () => {
    expect(eventsFromDiff({ op: "insert", changed: {} })).toEqual(["ticket.created"]);
  });

  describe("assignment", () => {
    it("null → someone is an assignment", () => {
      expect(diffEvents({ assigned_to_id: { from: null, to: "u1" } })).toEqual([
        "ticket.assigned",
      ]);
    });

    it("someone → null is an unassignment", () => {
      expect(diffEvents({ assigned_to_id: { from: "u1", to: null } })).toEqual([
        "ticket.unassigned",
      ]);
    });

    it("someone → someone else is BOTH assigned and reassigned", () => {
      // "When a ticket is assigned" reads as "when someone becomes its
      // owner", which a handover is.
      expect(diffEvents({ assigned_to_id: { from: "u1", to: "u2" } })).toEqual([
        "ticket.assigned",
        "ticket.reassigned",
      ]);
    });
  });

  describe("priority", () => {
    it("raising emits both changed and raised", () => {
      expect(diffEvents({ priority: { from: "low", to: "critical" } })).toEqual([
        "ticket.priority_changed",
        "ticket.priority_raised",
      ]);
    });

    it("lowering emits only changed", () => {
      expect(diffEvents({ priority: { from: "critical", to: "low" } })).toEqual([
        "ticket.priority_changed",
      ]);
    });

    it("an unrecognised priority still emits changed", () => {
      expect(diffEvents({ priority: { from: "low", to: "urgent" } })).toEqual([
        "ticket.priority_changed",
      ]);
    });
  });

  describe("status", () => {
    it("resolving emits both status_changed and resolved", () => {
      expect(diffEvents({ status: { from: "open", to: "resolved" } })).toEqual([
        "ticket.status_changed",
        "ticket.resolved",
      ]);
    });

    it("closing emits both status_changed and closed", () => {
      expect(diffEvents({ status: { from: "resolved", to: "closed" } })).toEqual([
        "ticket.status_changed",
        "ticket.closed",
      ]);
    });

    it("an ordinary move emits only status_changed", () => {
      expect(diffEvents({ status: { from: "open", to: "in_progress" } })).toEqual([
        "ticket.status_changed",
      ]);
    });
  });

  describe("escalation", () => {
    it("reads the direction off the new value", () => {
      expect(diffEvents({ is_escalated: { from: false, to: true } })).toEqual([
        "ticket.escalated",
      ]);
      expect(diffEvents({ is_escalated: { from: true, to: false } })).toEqual([
        "ticket.deescalated",
      ]);
    });
  });

  describe("timestamp stamps fire only on unset → set", () => {
    it("emits when the stamp first lands", () => {
      expect(diffEvents({ sla_breached_at: { from: null, to: "2026-10-01" } })).toEqual(
        ["ticket.sla_breached"],
      );
      expect(diffEvents({ first_response_at: { from: null, to: "2026-10-01" } })).toEqual(
        ["ticket.first_response"],
      );
    });

    it("stays quiet when a set stamp is merely rewritten", () => {
      // The SLA monitor's re-nag path touches sla_breach_reminded_at and can
      // rewrite neighbours; a second "breached!" alert would be wrong.
      expect(
        diffEvents({ sla_breached_at: { from: "2026-09-01", to: "2026-10-01" } }),
      ).toEqual([]);
    });

    it("stays quiet when a stamp is cleared", () => {
      expect(diffEvents({ sla_breached_at: { from: "2026-09-01", to: null } })).toEqual(
        [],
      );
    });
  });

  describe("reopen", () => {
    it("fires only when the counter goes up", () => {
      expect(diffEvents({ reopened_count: { from: 0, to: 1 } })).toEqual([
        "ticket.reopened",
      ]);
      expect(diffEvents({ reopened_count: { from: 2, to: 2 } })).toEqual([]);
      expect(diffEvents({ reopened_count: { from: 2, to: 1 } })).toEqual([]);
    });
  });

  describe("organization", () => {
    it("reads a real match off the status", () => {
      for (const to of ["account", "domain", "staff"]) {
        expect(diffEvents({ org_match_status: { from: "none", to } })).toEqual([
          "ticket.org_matched",
        ]);
      }
    });

    it("calls an unverified claim what it is", () => {
      expect(diffEvents({ org_match_status: { from: "none", to: "unverified" } })).toEqual(
        ["ticket.org_unverified"],
      );
    });

    it("counts a bare organization link as a match", () => {
      expect(diffEvents({ organization_id: { from: null, to: "org1" } })).toEqual([
        "ticket.org_matched",
      ]);
    });

    it("does not double-count a link that moved the status too", () => {
      expect(
        diffEvents({
          organization_id: { from: null, to: "org1" },
          org_match_status: { from: "none", to: "staff" },
        }),
      ).toEqual(["ticket.org_matched"]);
    });
  });

  describe("billing", () => {
    it("fires on a value landing, not on it clearing", () => {
      expect(diffEvents({ billable: { from: null, to: "monthly_plan" } })).toEqual([
        "ticket.billable_set",
      ]);
      expect(diffEvents({ billable: { from: "no", to: null } })).toEqual([]);
      expect(diffEvents({ invoice_number: { from: null, to: "INV-9" } })).toEqual([
        "ticket.invoice_set",
      ]);
      expect(diffEvents({ invoice_number: { from: "INV-9", to: "" } })).toEqual([]);
    });
  });

  describe("messages", () => {
    const msg = (m: ChangeDiff["message"]): ChangeDiff => ({
      op: "message",
      changed: {},
      message: m,
    });

    it("tells customer and agent replies apart", () => {
      expect(
        eventsFromDiff(
          msg({ authorType: "customer", isInternalNote: false, moderationStatus: "approved" }),
        ),
      ).toEqual(["ticket.customer_replied"]);
      expect(
        eventsFromDiff(
          msg({ authorType: "agent", isInternalNote: false, moderationStatus: "approved" }),
        ),
      ).toEqual(["ticket.agent_replied"]);
    });

    it("calls an internal note a note, whoever wrote it", () => {
      expect(
        eventsFromDiff(
          msg({ authorType: "agent", isInternalNote: true, moderationStatus: "approved" }),
        ),
      ).toEqual(["ticket.note_added"]);
    });

    it("does NOT treat a held reply as a customer reply", () => {
      // It is not part of the conversation yet; nobody has seen it.
      expect(
        eventsFromDiff(
          msg({ authorType: "customer", isInternalNote: false, moderationStatus: "held" }),
        ),
      ).toEqual(["ticket.reply_held"]);
    });

    it("ignores a system internal note, so the engine cannot answer itself", () => {
      // The `internal_note` action writes exactly this shape. If it produced
      // `note_added`, a rule triggered by a note that posts a note would run
      // away.
      expect(
        eventsFromDiff(
          msg({ authorType: "system", isInternalNote: true, moderationStatus: "approved" }),
        ),
      ).toEqual([]);
    });

    it("still reports a STAFF internal note", () => {
      expect(
        eventsFromDiff(
          msg({ authorType: "agent", isInternalNote: true, moderationStatus: "approved" }),
        ),
      ).toEqual(["ticket.note_added"]);
    });

    it("ignores a rejected reply and a system message", () => {
      expect(
        eventsFromDiff(
          msg({ authorType: "customer", isInternalNote: false, moderationStatus: "rejected" }),
        ),
      ).toEqual([]);
      expect(
        eventsFromDiff(
          msg({ authorType: "system", isInternalNote: false, moderationStatus: "approved" }),
        ),
      ).toEqual([]);
    });
  });

  it("emits several events from one multi-column write", () => {
    // Triage in one save: assign, raise, categorise.
    expect(
      diffEvents({
        assigned_to_id: { from: null, to: "u1" },
        priority: { from: "low", to: "high" },
        category: { from: "other", to: "network" },
      }),
    ).toEqual([
      "ticket.assigned",
      "ticket.priority_changed",
      "ticket.priority_raised",
      "ticket.category_changed",
    ]);
  });

  it("emits nothing for a write that touched no watched column", () => {
    expect(diffEvents({})).toEqual([]);
    expect(diffEvents({ updated_at: { from: "a", to: "b" } })).toEqual([]);
  });

  it("never emits a duplicate", () => {
    const events = diffEvents({
      status: { from: "open", to: "resolved" },
      assigned_to_id: { from: "u1", to: "u2" },
    });
    expect(events.length).toBe(new Set(events).size);
  });
});

function diffEvents(changed: ChangeDiff["changed"]) {
  return eventsFromDiff(diff(changed));
}
