import { describe, expect, it } from "vitest";
import {
  EMAIL_TEMPLATE_CATALOG,
  humanizeTemplateKey,
  isEditableField,
  isEmailTemplateKey,
} from "./template-catalog";

describe("template catalog", () => {
  it("has no duplicate template keys", () => {
    const keys = EMAIL_TEMPLATE_CATALOG.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("recognizes catalogued keys only", () => {
    expect(isEmailTemplateKey("ticketCreated")).toBe(true);
    expect(isEmailTemplateKey("shared")).toBe(true);
    expect(isEmailTemplateKey("notATemplate")).toBe(false);
  });

  it("excludes rich-text keys from editing", () => {
    // ticketResolved.viewLine is rendered with t.rich (embedded link markup),
    // so it must never be exposed as a free-text field.
    expect(isEditableField("ticketResolved", "viewLine")).toBe(false);
    expect(isEditableField("ticketResolved", "body")).toBe(true);
    expect(isEditableField("ticketCreated", "subject")).toBe(true);
  });

  it("humanizes camelCase keys", () => {
    expect(humanizeTemplateKey("ticketCreated")).toBe("Ticket created");
    expect(humanizeTemplateKey("ticketCreatedStaff")).toBe(
      "Ticket created staff",
    );
    expect(humanizeTemplateKey("shared")).toBe("Shared");
  });
});
