import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import { PERMISSION_MODULES } from "./permission-modules";
import { PERMISSIONS } from "./permissions";

// A permission with no wording renders as its key path in the one screen whose
// whole purpose is explaining what each grant means. The matrix reads these
// through a dynamic key (`label.${p.replace(/\./g,"__")}`) that the literal-key
// scanner in message-keys.test.ts cannot see, so they need their own test.

const matrix = (en as unknown as { roles: { matrix: Record<string, Record<string, string>> } })
  .roles.matrix;

describe("permission wording", () => {
  it("labels and describes every permission", () => {
    const missing: string[] = [];
    for (const p of PERMISSIONS) {
      const key = p.replace(/\./g, "__");
      if (!matrix.label?.[key]) missing.push(`label ${key}`);
      if (!matrix.description?.[key]) missing.push(`description ${key}`);
    }
    expect(missing).toEqual([]);
  });

  it("names and describes every module the matrix renders", () => {
    const missing: string[] = [];
    for (const m of PERMISSION_MODULES) {
      if (!matrix.module?.[m]) missing.push(`module ${m}`);
      if (!matrix.moduleDescription?.[m]) missing.push(`moduleDescription ${m}`);
    }
    expect(missing).toEqual([]);
  });

  it("has no wording for a permission that no longer exists", () => {
    // Stale entries are harmless but mislead the next person adding one.
    const known = new Set(PERMISSIONS.map((p) => p.replace(/\./g, "__")));
    const stale = [
      ...Object.keys(matrix.label ?? {}),
      ...Object.keys(matrix.description ?? {}),
    ].filter((k) => !known.has(k));
    expect(stale).toEqual([]);
  });

  it("no longer carries the reveal-toggle strings", () => {
    // 'N hidden — Show locked' told people hidden permissions exist. If it
    // comes back, the hidden policy has quietly stopped being hidden.
    expect(matrix.lockedHidden).toBeUndefined();
    expect(matrix.showLocked).toBeUndefined();
    expect(matrix.hideLocked).toBeUndefined();
  });
});
