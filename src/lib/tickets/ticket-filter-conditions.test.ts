import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { SLA_FILTER_VALUES, slaRadarCondition } from "./ticket-filter-conditions";

// No database in this suite, so the predicate is rendered to SQL text and
// checked. What matters is which columns each state looks at and that the
// dashboard card and the list share one definition.
const dialect = new PgDialect();
function render(state?: Parameters<typeof slaRadarCondition>[0]) {
  const { sql, params } = dialect.sqlToQuery(slaRadarCondition(state));
  return { sql, params };
}

describe("slaRadarCondition", () => {
  it("accepts exactly the two states the dashboard card links to", () => {
    expect([...SLA_FILTER_VALUES]).toEqual(["breached", "at_risk"]);
  });

  it("always excludes finished and SLA-paused tickets, whatever the state", () => {
    for (const state of [undefined, "breached", "at_risk"] as const) {
      const { sql, params } = render(state);
      // resolved/closed keep their SLA stamps forever, so status must exclude them.
      expect(sql).toContain('"tickets"."status" not in');
      expect(params).toEqual(expect.arrayContaining(["resolved", "closed"]));
      // Awaiting-customer / on-hold tickets are off the clock.
      expect(sql).toContain('"tickets"."sla_paused_at" is null');
    }
  });

  it("breached = the breach stamp is set, and nothing else is required of it", () => {
    const { sql } = render("breached");
    expect(sql).toContain('"tickets"."sla_breached_at" is not null');
    expect(sql).not.toContain("sla_warning_80_at");
  });

  it("at_risk = 80% warning stamped and NOT yet breached", () => {
    const { sql } = render("at_risk");
    expect(sql).toContain('"tickets"."sla_warning_80_at" is not null');
    expect(sql).toContain('"tickets"."sla_breached_at" is null');
  });

  it("no state = breached OR warned, the card's whole radar", () => {
    const { sql } = render();
    expect(sql).toContain('"tickets"."sla_breached_at" is not null');
    expect(sql).toContain('"tickets"."sla_warning_80_at" is not null');
    expect(sql).toContain(" or ");
  });
});
