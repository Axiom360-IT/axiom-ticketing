import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTION_DEFS,
  BILLABLE_TIERS,
  clientCatalog,
  CONDITION_FIELDS,
  CONDITION_FIELDS_IDS,
  CREATED_VIA,
  CSAT_RATINGS,
  ESCALATION_REASONS,
  EVENT_TRIGGER_DEFS,
  ORG_MATCH_STATUSES,
  ORIGINS,
  PRIORITIES,
  SAFE_ACTION_TYPES,
  SERVICE_TYPES,
  STATE_TRIGGER_DEFS,
  STATUSES,
  STREAMS,
  WATCHED_COLUMNS,
} from "./catalog";
import { columnsForEvent } from "./evaluate";
import {
  ACTION_LABELS,
  AUDIENCE_LABELS,
  CHANNEL_LABELS,
  DEDUPE_LABELS,
  EVENT_LABELS,
  FIELD_LABELS,
  OPERATOR_LABELS,
  STATE_LABELS,
} from "./labels";
import {
  ACTION_TYPES,
  CONDITION_OPERATORS,
  DEDUPE_POLICIES,
  EVENT_TRIGGERS,
  MUTATING_ACTIONS,
  NOTIFY_AUDIENCES,
  NOTIFY_CHANNELS,
  STATE_TRIGGERS,
} from "./types";

/**
 * The catalog is a hand-maintained description of behaviour that lives
 * elsewhere — the same class of thing as `lib/automations/registry.ts`, and
 * it rots the same way.
 *
 * TypeScript already covers most of it: the catalog records are exhaustive
 * `Record<Id, Def>`, so a field with no reader or an action with no
 * definition will not compile. What is left for a test is everything the
 * compiler cannot see:
 *
 *   • a vocabulary that drifted from the CHECK constraint on the column
 *   • an event whose columns the database trigger does not record
 *   • a label map that fell out of step
 *   • the SQL list and the TypeScript list of watched columns diverging
 */

const SRC = join(process.cwd(), "src");

function read(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), "utf8");
}

/**
 * Pull `'a','b','c'` out of a NAMED CHECK constraint in the schema source.
 *
 * Anchored on the constraint name rather than on `${t.column}`: the schema
 * also mentions columns inside partial-index predicates, and matching those
 * silently returns a different, smaller vocabulary — which is exactly what
 * the first version of this helper did for `status`.
 */
function checkVocabulary(source: string, constraint: string): string[] {
  const re = new RegExp(`"${constraint}"[\\s\\S]*?IN \\(([^)]*)\\)`);
  const m = source.match(re);
  if (!m?.[1]) throw new Error(`no CHECK named "${constraint}"`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1] as string);
}

describe("catalog ↔ database vocabularies", () => {
  const ticketsSchema = read("lib", "db", "schema", "tickets.ts");

  const cases: [string, string, readonly string[]][] = [
    ["tickets_priority_check", "priority", PRIORITIES],
    ["tickets_status_check", "status", STATUSES],
    ["tickets_service_type_check", "service_type", SERVICE_TYPES],
    ["tickets_stream_check", "stream", STREAMS],
    ["tickets_origin_check", "origin", ORIGINS],
    ["tickets_org_match_status_check", "org_match_status", ORG_MATCH_STATUSES],
    ["tickets_csat_rating_check", "csat_rating", CSAT_RATINGS],
    ["tickets_escalation_reason_check", "escalation_reason", ESCALATION_REASONS],
  ];

  for (const [constraint, label, vocabulary] of cases) {
    it(`offers exactly the ${label} values the column accepts`, () => {
      // A rule offering a value the CHECK rejects would be saveable and
      // permanently unmatchable — a silent, undebuggable dead rule.
      expect([...vocabulary].sort()).toEqual(
        checkVocabulary(ticketsSchema, constraint).sort(),
      );
    });
  }

  it("offers exactly the billable tiers the column accepts", () => {
    // Written as `IS NULL OR ... IN (...)`, so the generic helper's regex
    // picks it up but the nullability is ours to know about.
    expect([...BILLABLE_TIERS].sort()).toEqual(
      checkVocabulary(ticketsSchema, "tickets_billable_check").sort(),
    );
  });

  it("offers exactly the created_via values the column documents", () => {
    // No CHECK on this one — it is documented in a comment instead, so this
    // asserts against the comment rather than a constraint.
    const commented = [
      ...ticketsSchema.matchAll(
        /'(direct_email|forwarded_email|manual|portal|web_form)'/g,
      ),
    ].map((m) => m[1] as string);
    expect(new Set(CREATED_VIA)).toEqual(new Set(commented));
  });
});

describe("catalog ↔ the change-capture trigger", () => {
  const migration = read("lib", "db", "add-automation-rules.ts");

  it("watches the same columns in SQL and in TypeScript", () => {
    // The two lists are necessarily duplicated — one is embedded in PL/pgSQL,
    // the other is what the evaluator reasons about. A divergence means an
    // event that can never fire, or an outbox row nothing consumes.
    const block = migration.match(
      /const WATCHED_COLUMNS = \[([\s\S]*?)\];/,
    )?.[1];
    expect(block).toBeTruthy();
    const sqlSide = [...(block ?? "").matchAll(/"([a-z_0-9]+)"/g)].map(
      (m) => m[1] as string,
    );
    expect(sqlSide.sort()).toEqual([...WATCHED_COLUMNS].sort());
  });

  it("records every column an event trigger depends on", () => {
    const watched = new Set<string>(WATCHED_COLUMNS);
    const unreachable: string[] = [];
    for (const event of EVENT_TRIGGERS) {
      for (const col of columnsForEvent(event)) {
        if (!watched.has(col)) unreachable.push(`${event} needs ${col}`);
      }
    }
    expect(unreachable).toEqual([]);
  });

  it("watches no column that no event uses", () => {
    // Dead weight: an outbox row written on every write that touches the
    // column, consumed by nothing. Conditions do NOT justify watching a
    // column — they read fresh facts from the database at evaluation time,
    // not the diff. This assertion starting to fail means someone added a
    // column here without the trigger that consumes it.
    const used = new Set(EVENT_TRIGGERS.flatMap((e) => columnsForEvent(e)));
    expect(WATCHED_COLUMNS.filter((c) => !used.has(c))).toEqual([]);
  });

  it("installs both triggers and guards the write that fires them", () => {
    expect(migration).toContain("tickets_change_capture");
    expect(migration).toContain("messages_change_capture");
    // The EXCEPTION block is what stops an automation-bookkeeping problem
    // taking down ticket creation. Losing it would be invisible until the
    // worst possible moment.
    expect(migration.match(/EXCEPTION WHEN OTHERS THEN/g)?.length).toBe(2);
  });

  it("verifies the triggers landed rather than trusting CREATE", () => {
    expect(migration).toContain("FROM pg_trigger");
    expect(migration).toContain("was not installed");
  });
});

describe("catalog integrity", () => {
  it("gives every field a value shape it can actually be edited with", () => {
    const bad: string[] = [];
    for (const id of CONDITION_FIELDS_IDS) {
      const def = CONDITION_FIELDS[id];
      if (def.valueType === "enum" && !def.options?.length) {
        bad.push(`${id}: enum with no options`);
      }
      if (def.valueType === "reference" && !def.reference) {
        bad.push(`${id}: reference with no kind`);
      }
      if (def.operators.length === 0) bad.push(`${id}: no operators`);
      for (const op of def.operators) {
        if (!CONDITION_OPERATORS.includes(op)) {
          bad.push(`${id}: unknown operator ${op}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("only lets numeric fields be compared numerically", () => {
    const bad: string[] = [];
    const numeric = new Set(["gt", "gte", "lt", "lte"]);
    for (const id of CONDITION_FIELDS_IDS) {
      const def = CONDITION_FIELDS[id];
      if (def.valueType === "number") continue;
      for (const op of def.operators) {
        if (numeric.has(op)) bad.push(`${id} (${def.valueType}) offers ${op}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("gives every unit-bearing field a numeric type", () => {
    const bad = CONDITION_FIELDS_IDS.filter(
      (id) => CONDITION_FIELDS[id].unit && CONDITION_FIELDS[id].valueType !== "number",
    );
    expect(bad).toEqual([]);
  });

  it("has no duplicate ids anywhere", () => {
    for (const list of [
      CONDITION_FIELDS_IDS,
      EVENT_TRIGGERS,
      STATE_TRIGGERS,
      ACTION_TYPES,
    ] as readonly (readonly string[])[]) {
      expect(list.length).toBe(new Set(list).size);
    }
  });

  it("agrees with itself about which actions mutate a ticket", () => {
    const disagreements = ACTION_TYPES.filter(
      (t) => ACTION_DEFS[t].mutating !== MUTATING_ACTIONS.has(t),
    );
    expect(disagreements).toEqual([]);
  });

  it("keeps the safe set free of anything that writes to a ticket", () => {
    expect([...SAFE_ACTION_TYPES].sort()).toEqual(
      ["flag", "internal_note", "notify", "webhook"].sort(),
    );
  });

  it("weights a notification above a note", () => {
    // The hourly budget is weighted so a rule cannot send 200 texts while
    // technically staying under a 200-"action" cap.
    expect(ACTION_DEFS.notify.weight).toBeGreaterThan(
      ACTION_DEFS.internal_note.weight,
    );
  });

  it("gives every state trigger a sane default and a scan shape", () => {
    const shapes = new Set<string>();
    for (const id of STATE_TRIGGERS) {
      const def = STATE_TRIGGER_DEFS[id];
      expect(def.defaultMinutes).toBeGreaterThanOrEqual(0);
      shapes.add(def.shape);
    }
    // One batched query per shape, not one per rule (invariant I10). If two
    // triggers ever share a shape this still holds; the assertion is only
    // that no shape is missing.
    expect(shapes.size).toBe(STATE_TRIGGERS.length);
  });
});

describe("labels", () => {
  // The Record types already force a label per id at compile time. These
  // check the things a type cannot: that nothing is blank, and that nothing
  // leaked a raw identifier.
  const maps: [string, Record<string, string>, readonly string[]][] = [
    ["events", EVENT_LABELS, EVENT_TRIGGERS],
    ["states", STATE_LABELS, STATE_TRIGGERS],
    ["fields", FIELD_LABELS, CONDITION_FIELDS_IDS],
    ["operators", OPERATOR_LABELS, CONDITION_OPERATORS],
    ["actions", ACTION_LABELS, ACTION_TYPES],
    ["channels", CHANNEL_LABELS, NOTIFY_CHANNELS],
    ["audiences", AUDIENCE_LABELS, NOTIFY_AUDIENCES],
    ["dedupe", DEDUPE_LABELS, DEDUPE_POLICIES],
  ];

  for (const [name, map, ids] of maps) {
    it(`has readable wording for every ${name} entry`, () => {
      const bad: string[] = [];
      for (const id of ids) {
        const label = map[id];
        if (!label || label.trim() === "") bad.push(`${id}: blank`);
        // A single word that happens to equal its id ("priority", "is") is
        // perfectly good English. An underscore never is.
        else if (/_/.test(label)) bad.push(`${id}: "${label}" looks like an id`);
      }
      expect(bad).toEqual([]);
    });
  }
});

describe("clientCatalog", () => {
  const client = clientCatalog();

  it("strips the accessors so it can cross to the browser", () => {
    for (const id of CONDITION_FIELDS_IDS) {
      expect(client.fields[id]).toBeDefined();
      expect("read" in (client.fields[id] as object)).toBe(false);
    }
  });

  it("survives a JSON round trip with nothing lost", () => {
    // It is handed to a client component as a prop, so this is literally what
    // happens to it in production.
    const round = JSON.parse(JSON.stringify(client));
    expect(Object.keys(round.fields).sort()).toEqual(
      [...CONDITION_FIELDS_IDS].sort(),
    );
    expect(Object.keys(round.events).sort()).toEqual([...EVENT_TRIGGERS].sort());
    expect(Object.keys(round.actions).sort()).toEqual([...ACTION_TYPES].sort());
  });

  it("carries every event and state the engine knows", () => {
    expect(client.eventOrder).toEqual(EVENT_TRIGGERS);
    expect(client.stateOrder).toEqual(STATE_TRIGGERS);
    expect(Object.keys(EVENT_TRIGGER_DEFS).sort()).toEqual(
      [...EVENT_TRIGGERS].sort(),
    );
  });
});
