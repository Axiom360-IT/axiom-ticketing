import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import { SETTING_KEYS } from "@/lib/settings-registry";
import { AUTOMATIONS, AUTOMATION_BY_ID } from "./registry";

/**
 * The registry is a hand-maintained description of code that lives elsewhere,
 * which is exactly the kind of thing that rots. Each check here corresponds to
 * a way the Automations page could start lying to an operator:
 *
 *   • an id that matches no function  → a card that says "never run" forever
 *   • a function with no card         → a job nobody knows exists
 *   • a wrong cron                    → a schedule shown that isn't the real one
 *   • a setting key that moved        → a knob showing "default" forever
 *   • a missing translation           → a card titled "automations.jobs.x.name"
 *
 * Read from source text rather than by importing the functions: they pull in
 * the db client, Resend and Twilio, none of which vitest can load.
 */

const FUNCTIONS_DIR = join(process.cwd(), "src", "inngest", "functions");

type Declared = { id: string; cron?: string; event?: string; file: string };

function declaredFunctions(): Declared[] {
  const out: Declared[] = [];
  for (const entry of readdirSync(FUNCTIONS_DIR)) {
    if (!entry.endsWith(".ts") || entry === "index.ts") continue;
    const src = readFileSync(join(FUNCTIONS_DIR, entry), "utf8");
    const id = src.match(/\bid:\s*"([^"]+)"/)?.[1];
    if (!id) continue;
    out.push({
      id,
      cron: src.match(/triggers:\s*cron\("([^"]+)"\)/)?.[1],
      event: src.match(/triggers:\s*eventType\("([^"]+)"\)/)?.[1],
      file: entry,
    });
  }
  return out;
}

function lookup(path: string): unknown {
  let node: unknown = en;
  for (const segment of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

describe("automation registry", () => {
  const declared = declaredFunctions();

  it("finds the Inngest functions at all (guards the parser itself)", () => {
    // If this ever drops to zero the checks below would all pass vacuously.
    expect(declared.length).toBeGreaterThanOrEqual(17);
  });

  it("has no id that does not exist as an Inngest function", () => {
    const real = new Set(declared.map((d) => d.id));
    const orphans = AUTOMATIONS.filter((a) => !real.has(a.id)).map((a) => a.id);
    expect(orphans).toEqual([]);
  });

  it("lists every registered Inngest function", () => {
    const missing = declared
      .filter((d) => !AUTOMATION_BY_ID.has(d.id))
      .map((d) => `${d.id} (${d.file})`);
    expect(missing).toEqual([]);
  });

  it("records each job's real trigger", () => {
    const wrong: string[] = [];
    for (const d of declared) {
      const def = AUTOMATION_BY_ID.get(d.id);
      if (!def) continue;
      if (d.cron && def.cron !== d.cron) {
        wrong.push(`${d.id}: registry says ${def.cron}, code says ${d.cron}`);
      }
      if (d.event && def.event !== d.event) {
        wrong.push(`${d.id}: registry says ${def.event}, code says ${d.event}`);
      }
      // kind must agree with how it is actually triggered
      if (d.cron && def.kind !== "scheduled") {
        wrong.push(`${d.id}: cron-triggered but registered as ${def.kind}`);
      }
      if (d.event && def.kind !== "reactive") {
        wrong.push(`${d.id}: event-triggered but registered as ${def.kind}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("only names setting keys that exist in the registry", () => {
    const valid = new Set<string>(SETTING_KEYS as readonly string[]);
    const bad: string[] = [];
    for (const a of AUTOMATIONS) {
      if (a.enabledKey && !valid.has(a.enabledKey)) {
        bad.push(`${a.id}.enabledKey → ${a.enabledKey}`);
      }
      for (const k of a.settingKeys ?? []) {
        if (!valid.has(k)) bad.push(`${a.id}.settingKeys → ${k}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("has a name and description for every automation", () => {
    const missing: string[] = [];
    for (const a of AUTOMATIONS) {
      for (const field of ["name", "description"] as const) {
        const path = `automations.jobs.${a.id}.${field}`;
        if (typeof lookup(path) !== "string") missing.push(path);
      }
    }
    expect(missing).toEqual([]);
  });

  it("tracks runs for every scheduled job and none of the reactive ones", () => {
    // Reactive jobs fire per-notification; recording those would bury the
    // signal and duplicate the notifications table.
    const wrong = AUTOMATIONS.filter(
      (a) => a.tracked !== (a.kind === "scheduled"),
    ).map((a) => `${a.id} (${a.kind}, tracked=${a.tracked})`);
    expect(wrong).toEqual([]);
  });

  it("wraps every tracked job in withAutomationRun, under its registry id", () => {
    // The wrapper is what writes the run row. A tracked job missing it shows
    // "never run" on a panel whose whole purpose is answering that question.
    const problems: string[] = [];
    for (const a of AUTOMATIONS.filter((x) => x.tracked)) {
      const d = declared.find((x) => x.id === a.id);
      if (!d) continue;
      const src = readFileSync(join(FUNCTIONS_DIR, d.file), "utf8");
      if (!src.includes("withAutomationRun")) {
        problems.push(`${a.id}: not wrapped`);
      } else if (!src.includes(`withAutomationRun("${a.id}"`)) {
        problems.push(`${a.id}: wrapped under a different id`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("has unique ids", () => {
    const ids = AUTOMATIONS.map((a) => a.id);
    expect(ids.length).toBe(new Set(ids).size);
  });
});
