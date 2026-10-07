import { describe, expect, it } from "vitest";
import { describeRule } from "./describe";
import { ruleInputSchema } from "./schema";
import { RULE_TEMPLATES, TEMPLATE_CATEGORY_LABELS, templateById } from "./templates";

// The template library is the front door. A template that does not validate
// is worse than no template: the operator clicks it, the form fills, and the
// save button rejects their own choice with an error about a field they never
// touched.

describe("rule templates", () => {
  it("has some", () => {
    expect(RULE_TEMPLATES.length).toBeGreaterThanOrEqual(10);
  });

  it("has unique ids", () => {
    const ids = RULE_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const template of RULE_TEMPLATES) {
    describe(template.id, () => {
      it("passes the same validation a hand-written rule does", () => {
        const result = ruleInputSchema.safeParse({
          name: template.name,
          trigger: template.trigger,
          conditions: template.conditions,
          actions: template.actions,
          dedupe: template.dedupe,
        });
        if (!result.success) {
          throw new Error(
            `${template.id}: ${result.error.issues.map((i) => i.message).join("; ")}`,
          );
        }
        expect(result.success).toBe(true);
      });

      it("only records — it never notifies out of the box", () => {
        // Switch on, leave a day, read the log, THEN add the notification.
        // A template that texted people the moment it was clicked would make
        // trying one feel dangerous.
        expect(template.actions.every((a) => a.type === "flag")).toBe(true);
      });

      it("renders as a sentence with no identifiers in it", () => {
        const sentence = describeRule(template);
        expect(sentence.startsWith("When") || sentence.startsWith("every")).toBe(
          true,
        );
        expect(sentence.endsWith(".")).toBe(true);
        // A leaked field id or enum value would read as `is in_progress`.
        expect(sentence).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
      });

      it("explains itself", () => {
        expect(template.blurb.length).toBeGreaterThan(20);
        expect(template.tweak.length).toBeGreaterThan(10);
        expect(TEMPLATE_CATEGORY_LABELS[template.category]).toBeTruthy();
      });
    });
  }

  it("finds a template by id, and nothing by a wrong one", () => {
    expect(templateById("critical-unowned")?.name).toBeTruthy();
    expect(templateById("nope")).toBeUndefined();
  });
});
