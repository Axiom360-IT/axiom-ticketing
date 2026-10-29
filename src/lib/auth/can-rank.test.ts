import { describe, expect, it } from "vitest";
import {
  can,
  isStrictRequester,
  isStrictTechnician,
  type CanContext,
  type SessionUser,
} from "./can";
import {
  ALL_PERMISSIONS,
  COORDINATOR_PERMISSIONS,
  type Permission,
} from "./permissions";

// The Technical Lead tier, as `can()` sees it. rank.test.ts covers the pure
// rules; this covers the places they meet the permission gate.

function makeUser(opts: {
  id?: string;
  permissions: readonly Permission[];
  roleNames: readonly string[];
  rank?: number;
  isImpersonating?: boolean;
}): SessionUser {
  return {
    id: opts.id ?? "u",
    permissions: new Set(opts.permissions),
    roleNames: new Set(opts.roleNames),
    rank: opts.rank,
    isImpersonating: opts.isImpersonating ?? false,
  };
}

const technicalLead = (id = "tl") =>
  makeUser({ id, permissions: ALL_PERMISSIONS, roleNames: ["Technical Lead"], rank: 2 });
const superAdmin = (id = "sa") =>
  makeUser({ id, permissions: ALL_PERMISSIONS, roleNames: ["Super Admin"], rank: 1 });
const coordinator = (id = "co") =>
  makeUser({ id, permissions: COORDINATOR_PERMISSIONS, roleNames: ["Coordinator"], rank: 0 });

const target = (id: string) =>
  ({ type: "user", user: { id, createdById: null } }) as const;

function ctx(opts: {
  ranks?: Record<string, number>;
  roles?: Record<string, string[]>;
  withRank?: boolean;
} = {}): CanContext {
  const base: CanContext = {
    isDescendantOf: async () => false,
    userHasRole: async (u, r) => (opts.roles?.[u] ?? []).includes(r),
    isLastActiveSuperAdmin: async () => false,
  };
  return opts.withRank === false
    ? base
    : { ...base, userRank: async (u) => opts.ranks?.[u] ?? 0 };
}

describe("a Technical Lead is staff, not a customer", () => {
  it("is not a strict technician and not a strict requester", () => {
    const tl = makeUser({ permissions: ALL_PERMISSIONS, roleNames: ["Technical Lead"] });
    expect(isStrictTechnician(tl)).toBe(false);
    expect(isStrictRequester(tl)).toBe(false);
  });

  it("stays a strict technician if the Technician role is all they hold", () => {
    // Guard against the elevated list swallowing everyone.
    const tech = makeUser({ permissions: [], roleNames: ["Technician"] });
    expect(isStrictTechnician(tech)).toBe(true);
  });

  it("can manage any user, as a Super Admin can", async () => {
    expect(
      await can(technicalLead(), "users.update", target("stranger"), ctx()),
    ).toBe(true);
  });

  it("is a Super-Admin-tier requester even when the rank was never loaded", () => {
    // A session built without `rank` (a fixture, an unmigrated row) must not
    // demote a Technical Lead — rankOf floors by role name.
    expect(
      isStrictRequester(
        makeUser({ permissions: [], roleNames: ["Technical Lead"], rank: undefined }),
      ),
    ).toBe(false);
  });
});

describe("nobody acts on an account that outranks them", () => {
  const actions = ["users.update", "users.deactivate", "users.reset_password"] as const;

  for (const action of actions) {
    it(`stops a Super Admin using ${action} on the Technical Lead`, async () => {
      // THE case this exists for: without it, the hierarchy bypass lets a
      // Super Admin reset the Technical Lead's password and sign in as them.
      expect(
        await can(superAdmin("sa"), action, target("tl"), ctx({ ranks: { tl: 2 } })),
      ).toBe(false);
    });

    it(`lets the Technical Lead use ${action} on a Super Admin`, async () => {
      expect(
        await can(technicalLead("tl"), action, target("sa"), ctx({ ranks: { sa: 1 } })),
      ).toBe(true);
    });

    it(`leaves ${action} between PEERS unchanged`, async () => {
      // Strictly "higher", not "equal or higher": no Super Admin can edit
      // another's ROLES, but account administration between peers is as before.
      expect(
        await can(superAdmin("sa-1"), action, target("sa-2"), ctx({ ranks: { "sa-2": 1 } })),
      ).toBe(true);
    });
  }

  it("applies the same rule to a lower rank reaching up", async () => {
    // A Coordinator holding users.update cannot touch a Super Admin either.
    const c = makeUser({
      id: "co",
      permissions: [...COORDINATOR_PERMISSIONS, "users.update"],
      roleNames: ["Coordinator"],
    });
    expect(await can(c, "users.update", target("sa"), ctx({ ranks: { sa: 1 } }))).toBe(false);
  });

  it("does nothing when the context supplies no rank (the pre-existing behaviour)", async () => {
    expect(
      await can(superAdmin("sa"), "users.update", target("tl"), ctx({ withRank: false })),
    ).toBe(true);
  });

  it("still lets anyone edit their own record", async () => {
    expect(await can(technicalLead("tl"), "users.update", target("tl"), ctx({ ranks: { tl: 2 } }))).toBe(true);
    expect(await can(superAdmin("sa"), "users.update", target("sa"), ctx({ ranks: { sa: 1 } }))).toBe(true);
  });
});

describe("impersonation immunity covers the Technical Lead", () => {
  it("blocks impersonating a Technical Lead", async () => {
    const c = ctx({ roles: { tl: ["Technical Lead"] } });
    expect(await can(superAdmin(), "users.impersonate", target("tl"), c)).toBe(false);
  });

  it("still blocks impersonating a Super Admin", async () => {
    const c = ctx({ roles: { sa2: ["Super Admin"] } });
    expect(await can(technicalLead(), "users.impersonate", target("sa2"), c)).toBe(false);
  });

  it("still allows impersonating an ordinary user", async () => {
    expect(
      await can(technicalLead(), "users.impersonate", target("tech"), ctx()),
    ).toBe(true);
  });
});

describe("the new configuration powers are blocked during impersonation", () => {
  const impersonating = (perm: Permission) =>
    makeUser({
      permissions: [perm],
      roleNames: ["Super Admin"],
      isImpersonating: true,
    });

  it.each(["settings.technical.update", "rules.manage", "settings.update"] as const)(
    "blocks %s",
    async (perm) => {
      expect(await can(impersonating(perm), perm, { type: "global" })).toBe(false);
    },
  );

  it("does not block merely READING technical settings", async () => {
    expect(
      await can(impersonating("settings.technical.view"), "settings.technical.view", {
        type: "global",
      }),
    ).toBe(true);
  });
});

describe("the new permissions are real gates", () => {
  it("refuses a user who lacks them", async () => {
    // `can()` falls through to `default: return true` AFTER the holder check
    // for a global permission — so the holder check is the whole gate.
    for (const perm of ["rules.manage", "settings.technical.view", "settings.technical.update"] as const) {
      expect(
        await can(coordinator(), perm, { type: "global" }),
      ).toBe(false);
    }
  });

  it("allows a user who holds them", async () => {
    for (const perm of ["rules.manage", "settings.technical.view", "settings.technical.update"] as const) {
      expect(await can(technicalLead(), perm, { type: "global" })).toBe(true);
    }
  });
});
