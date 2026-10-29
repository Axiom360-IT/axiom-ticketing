import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  changesBeyondCaller,
  permissionChanges,
  permissionsBeyondCaller,
} from "./permission-diff";
import { PERMISSION_MODULES, permissionsByModule } from "./permission-modules";
import { ALL_PERMISSIONS, PERMISSIONS, type Permission } from "./permissions";
import {
  canManageRank,
  DEFAULT_UNDELEGABLE_DISPLAY,
  ELEVATED_ROLE_NAMES,
  isAtLeastSuperAdmin,
  parseUndelegableDisplay,
  RANK,
  rankOf,
  roleAssignability,
  roleChangesAboveAuthority,
  roleSetChanges,
  STAFF_ROLE_NAMES,
  SUPER_ADMIN_ROLE,
  TECHNICAL_LEAD_ROLE,
} from "./rank";

const names = (...n: string[]) => ({ roleNames: new Set(n) });

describe("rankOf", () => {
  it("is the highest rank among the roles", () => {
    expect(rankOf({ rank: 1, roleNames: new Set(["Coordinator"]) })).toBe(1);
    expect(rankOf({ rank: 2, roleNames: new Set() })).toBe(2);
  });

  it("defaults to the lowest rank", () => {
    // An unmigrated session or a test fixture must fail SAFE.
    expect(rankOf(names("Coordinator"))).toBe(RANK.STAFF);
    expect(rankOf(names())).toBe(RANK.STAFF);
  });

  it("floors a Super Admin at 1 even if the column was never migrated", () => {
    expect(rankOf(names(SUPER_ADMIN_ROLE))).toBe(RANK.SUPER_ADMIN);
    expect(rankOf({ rank: 0, roleNames: new Set([SUPER_ADMIN_ROLE]) })).toBe(1);
  });

  it("floors a Technical Lead at 2", () => {
    expect(rankOf(names(TECHNICAL_LEAD_ROLE))).toBe(RANK.TECHNICAL_LEAD);
  });

  it("never LOWERS a rank — the name floor cannot demote anyone", () => {
    expect(rankOf({ rank: 2, roleNames: new Set([SUPER_ADMIN_ROLE]) })).toBe(2);
  });

  it("takes the max when a user holds both (the Technical Lead keeps Super Admin)", () => {
    expect(rankOf(names(SUPER_ADMIN_ROLE, TECHNICAL_LEAD_ROLE))).toBe(2);
  });
});

describe("isAtLeastSuperAdmin", () => {
  it("is true from rank 1 up and false below", () => {
    expect(isAtLeastSuperAdmin(names(SUPER_ADMIN_ROLE))).toBe(true);
    expect(isAtLeastSuperAdmin(names(TECHNICAL_LEAD_ROLE))).toBe(true);
    expect(isAtLeastSuperAdmin({ rank: 1, roleNames: new Set() })).toBe(true);
    expect(isAtLeastSuperAdmin(names("IT Director", "Coordinator"))).toBe(false);
  });
});

describe("canManageRank — THE rule", () => {
  it("requires a STRICTLY higher rank", () => {
    expect(canManageRank(2, 1)).toBe(true);
    expect(canManageRank(2, 0)).toBe(true);
    expect(canManageRank(1, 0)).toBe(true);
  });

  it("refuses an equal rank: no Super Admin can edit another", () => {
    expect(canManageRank(1, 1)).toBe(false);
    expect(canManageRank(0, 0)).toBe(false);
  });

  it("refuses to reach up, and nothing outranks the Technical Lead", () => {
    expect(canManageRank(1, 2)).toBe(false);
    expect(canManageRank(2, 2)).toBe(false);
    expect(canManageRank(Number.MAX_SAFE_INTEGER, 2)).toBe(true);
  });
});

describe("roleSetChanges", () => {
  it("separates what was added from what was removed", () => {
    expect(roleSetChanges(["a", "b"], ["b", "c"])).toEqual({
      added: ["c"],
      removed: ["a"],
    });
  });

  it("reports nothing for an unchanged set, in any order", () => {
    expect(roleSetChanges(["a", "b"], ["b", "a"])).toEqual({
      added: [],
      removed: [],
    });
  });

  it("tolerates duplicates", () => {
    expect(roleSetChanges(["a", "a"], ["a"])).toEqual({ added: [], removed: [] });
  });
});

describe("roleChangesAboveAuthority", () => {
  const known = [
    { id: "tl", rank: 2 },
    { id: "sa", rank: 1 },
    { id: "coord", rank: 0 },
    { id: "tech", rank: 0 },
  ];

  it("lets a Super Admin hand out and take back ordinary roles", () => {
    expect(roleChangesAboveAuthority(1, ["coord"], ["tech"], known)).toEqual([]);
    expect(roleChangesAboveAuthority(1, [], ["coord", "tech"], known)).toEqual([]);
  });

  it("stops a Super Admin making ANOTHER Super Admin", () => {
    expect(roleChangesAboveAuthority(1, ["coord"], ["coord", "sa"], known)).toEqual(["sa"]);
  });

  it("stops a Super Admin removing the role from one", () => {
    expect(roleChangesAboveAuthority(1, ["sa"], [], known)).toEqual(["sa"]);
  });

  it("stops a Super Admin reaching for the Technical Lead role", () => {
    expect(roleChangesAboveAuthority(1, [], ["tl"], known)).toEqual(["tl"]);
  });

  it("IGNORES a role that is held and kept", () => {
    // Editing another Super Admin's phone number resubmits their roles
    // unchanged. That must not be refused.
    expect(roleChangesAboveAuthority(1, ["sa"], ["sa"], known)).toEqual([]);
    expect(roleChangesAboveAuthority(1, ["sa", "coord"], ["sa", "tech"], known)).toEqual([]);
  });

  it("lets the Technical Lead manage a Super Admin", () => {
    expect(roleChangesAboveAuthority(2, [], ["sa"], known)).toEqual([]);
    expect(roleChangesAboveAuthority(2, ["sa"], [], known)).toEqual([]);
  });

  it("does not let even the Technical Lead mint another one through the app", () => {
    // The role is immutable from inside the product; a script manages it.
    expect(roleChangesAboveAuthority(2, [], ["tl"], known)).toEqual(["tl"]);
  });

  it("treats an unknown id as rank 0 rather than blocking on it", () => {
    expect(roleChangesAboveAuthority(1, [], ["ghost"], known)).toEqual([]);
  });
});

describe("roleAssignability", () => {
  const held = new Set<string>(["tickets.view", "tickets.reply"]);
  const base = { callerRank: 1, callerPermissions: held, callerHasAll: false };

  it("is ok for a lower-rank role within the caller's permissions", () => {
    expect(
      roleAssignability({ ...base, role: { rank: 0, permissions: ["tickets.view"] } }),
    ).toBe("ok");
  });

  it("names rank before permissions", () => {
    expect(
      roleAssignability({ ...base, role: { rank: 1, permissions: ["users.impersonate"] } }),
    ).toBe("rank");
  });

  it("refuses a role holding a permission the caller lacks", () => {
    expect(
      roleAssignability({ ...base, role: { rank: 0, permissions: ["tickets.view", "audit.export"] } }),
    ).toBe("permissions");
  });

  it("lets a caller who holds everything skip the permission check, not the rank one", () => {
    const all = { ...base, callerHasAll: true };
    expect(roleAssignability({ ...all, role: { rank: 0, permissions: ["audit.export"] } })).toBe("ok");
    expect(roleAssignability({ ...all, role: { rank: 1, permissions: [] } })).toBe("rank");
  });

  it("is ok for an empty role", () => {
    expect(roleAssignability({ ...base, role: { rank: 0, permissions: [] } })).toBe("ok");
  });
});

describe("role lists", () => {
  it("counts the Technical Lead as staff, or an account holding only that role would be a customer", () => {
    expect(STAFF_ROLE_NAMES).toContain(TECHNICAL_LEAD_ROLE);
    expect(STAFF_ROLE_NAMES).toContain(SUPER_ADMIN_ROLE);
    expect(STAFF_ROLE_NAMES).toContain("Technician");
  });

  it("gives the Technical Lead full ticket visibility, but not the Technician", () => {
    expect(ELEVATED_ROLE_NAMES).toContain(TECHNICAL_LEAD_ROLE);
    expect(ELEVATED_ROLE_NAMES).not.toContain("Technician");
  });
});

describe("parseUndelegableDisplay", () => {
  it("defaults to hidden", () => {
    expect(DEFAULT_UNDELEGABLE_DISPLAY).toBe("hidden");
    expect(parseUndelegableDisplay(undefined)).toBe("hidden");
    expect(parseUndelegableDisplay(null)).toBe("hidden");
  });

  it("falls back to hidden on garbage, never to the MORE revealing mode", () => {
    expect(parseUndelegableDisplay("show-everything")).toBe("hidden");
    expect(parseUndelegableDisplay(1)).toBe("hidden");
  });

  it("accepts locked", () => {
    expect(parseUndelegableDisplay("locked")).toBe("locked");
  });
});

// ── Permission deltas ─────────────────────────────────────────────────

const P = (...p: Permission[]) => p;

describe("permissionChanges", () => {
  it("separates added from removed", () => {
    expect(
      permissionChanges(P("tickets.view", "tickets.reply"), P("tickets.view", "tickets.close")),
    ).toEqual({ added: ["tickets.close"], removed: ["tickets.reply"] });
  });

  it("is empty when nothing moved", () => {
    expect(permissionChanges(P("tickets.view"), P("tickets.view"))).toEqual({
      added: [],
      removed: [],
    });
  });
});

describe("changesBeyondCaller", () => {
  const held = new Set<Permission>(["tickets.view", "tickets.reply"]);

  it("allows a change within the caller's own permissions", () => {
    const c = permissionChanges(P("tickets.view"), P("tickets.view", "tickets.reply"));
    expect(changesBeyondCaller(c, held)).toEqual([]);
  });

  it("refuses to ADD a permission the caller lacks", () => {
    const c = permissionChanges(P("tickets.view"), P("tickets.view", "audit.export"));
    expect(changesBeyondCaller(c, held)).toEqual(["audit.export"]);
  });

  it("refuses to REMOVE one the caller lacks", () => {
    // The new edge: it is not theirs to take away.
    const c = permissionChanges(P("tickets.view", "audit.export"), P("tickets.view"));
    expect(changesBeyondCaller(c, held)).toEqual(["audit.export"]);
  });

  it("leaves a permission the caller cannot hold ALONE, which is what lets them save the role", () => {
    // A role contains audit.export; the editor lacks it and does not touch it.
    const c = permissionChanges(
      P("tickets.view", "audit.export"),
      P("tickets.view", "audit.export", "tickets.reply"),
    );
    expect(changesBeyondCaller(c, held)).toEqual([]);
  });

  it("lets a caller who holds everything change anything", () => {
    const c = permissionChanges(P(), P("audit.export", "users.impersonate"));
    expect(changesBeyondCaller(c, new Set(ALL_PERMISSIONS))).toEqual([]);
  });

  it("still agrees with the whole-set check for a brand-new role", () => {
    // Creation is a delta from nothing; the two functions must not disagree.
    const requested = new Set(P("tickets.view", "audit.export"));
    expect(permissionsBeyondCaller(requested, held)).toEqual(["audit.export"]);
    expect(changesBeyondCaller(permissionChanges(P(), requested), held)).toEqual(["audit.export"]);
  });
});

// ── The matrix must be able to show every permission ──────────────────

describe("permission modules", () => {
  it("places EVERY permission in a group the matrix renders", () => {
    // A permission with no group is never shown, so it can never be delegated.
    // `organizations.*` and `worklog.view_all` were exactly this.
    const placed = new Set(Object.values(permissionsByModule()).flat());
    const orphans = PERMISSIONS.filter((p) => !placed.has(p));
    expect(orphans).toEqual([]);
  });

  it("has no empty group", () => {
    const empty = PERMISSION_MODULES.filter(
      (m) => permissionsByModule()[m].length === 0,
    );
    expect(empty).toEqual([]);
  });
});

// ── No hardcoded role names outside rank.ts ───────────────────────────
//
// There were 29 live-code sites comparing against the literal "Super Admin".
// Each is now either a rank-aware helper or a named constant, so that adding
// a tier means touching one file. This keeps it that way.

describe("no hardcoded tier names", () => {
  const SRC = join(process.cwd(), "src");

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  }

  const offenders = (needle: RegExp): string[] => {
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      const rel = file.slice(SRC.length + 1);
      // rank.ts defines them; db scripts/seeds are installers that must name
      // the role they create; tests assert against the names.
      if (rel === join("lib", "auth", "rank.ts")) continue;
      if (rel.startsWith(join("lib", "db") + "/")) continue;
      if (/\.test\.tsx?$/.test(rel)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const t = line.trim();
          if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
          if (needle.test(line)) hits.push(`${rel}:${i + 1}  ${t.slice(0, 90)}`);
        });
    }
    return hits;
  };

  it('has no "Super Admin" literal outside rank.ts', () => {
    expect(offenders(/["'`]Super Admin["'`]/)).toEqual([]);
  });

  it('has no "Technical Lead" literal outside rank.ts', () => {
    expect(offenders(/["'`]Technical Lead["'`]/)).toEqual([]);
  });
});
