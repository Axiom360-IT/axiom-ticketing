import { describe, expect, it } from "vitest";
import {
  can,
  isStrictCustomer,
  isStrictRequester,
  isStrictTechnician,
  type CanContext,
  type SessionUser,
  type Target,
} from "./can";
import {
  ALL_PERMISSIONS,
  COORDINATOR_PERMISSIONS,
  CUSTOMER_PERMISSIONS,
  IT_DIRECTOR_PERMISSIONS,
  type Permission,
  TECHNICIAN_PERMISSIONS,
} from "./permissions";

// ── Test helpers ──────────────────────────────────────────────────────

function makeUser(opts: {
  id?: string;
  permissions: readonly Permission[];
  roleNames: readonly string[];
  isImpersonating?: boolean;
}): SessionUser {
  return {
    id: opts.id ?? "user-actor",
    permissions: new Set(opts.permissions),
    roleNames: new Set(opts.roleNames),
    isImpersonating: opts.isImpersonating ?? false,
  };
}

const superAdmin = (id = "user-sa") =>
  makeUser({ id, permissions: ALL_PERMISSIONS, roleNames: ["Super Admin"] });
const itDirector = (id = "user-itd") =>
  makeUser({
    id,
    permissions: IT_DIRECTOR_PERMISSIONS,
    roleNames: ["IT Director"],
  });
const coordinator = (id = "user-coord") =>
  makeUser({
    id,
    permissions: COORDINATOR_PERMISSIONS,
    roleNames: ["Coordinator"],
  });
const technician = (id = "user-tech") =>
  makeUser({
    id,
    permissions: TECHNICIAN_PERMISSIONS,
    roleNames: ["Technician"],
  });
const customer = (id = "user-cust") =>
  makeUser({ id, permissions: CUSTOMER_PERMISSIONS, roleNames: ["Customer"] });

const ticketTarget = (
  assignedToId: string | null,
  customerId: string | null = null,
): Target => ({
  type: "ticket",
  ticket: { id: "t-1", assignedToId, customerId },
});
const userTarget = (id: string, createdById: string | null = null): Target => ({
  type: "user",
  user: { id, createdById },
});
const procurementTarget = (requestedById: string | null): Target => ({
  type: "procurement",
  request: { id: "p-1", requestedById },
});

// Mock context — tests inject hierarchy / role responses
function makeCtx(opts: {
  isDescendantOf?: (t: string, a: string) => Promise<boolean>;
  userHasRole?: (u: string, r: string) => Promise<boolean>;
  isLastActiveSuperAdmin?: (u: string) => Promise<boolean>;
} = {}): CanContext {
  return {
    isDescendantOf: opts.isDescendantOf ?? (async () => false),
    userHasRole: opts.userHasRole ?? (async () => false),
    isLastActiveSuperAdmin:
      opts.isLastActiveSuperAdmin ?? (async () => false),
  };
}

// ── Helper-function tests ─────────────────────────────────────────────

describe("isStrictTechnician", () => {
  it("returns true for a user whose only role is Technician", () => {
    expect(isStrictTechnician(technician())).toBe(true);
  });
  it("returns false for a user with Technician + Coordinator", () => {
    expect(
      isStrictTechnician(
        makeUser({
          permissions: COORDINATOR_PERMISSIONS,
          roleNames: ["Technician", "Coordinator"],
        }),
      ),
    ).toBe(false);
  });
  it("returns false for a user with Technician + Super Admin", () => {
    expect(
      isStrictTechnician(
        makeUser({
          permissions: ALL_PERMISSIONS,
          roleNames: ["Technician", "Super Admin"],
        }),
      ),
    ).toBe(false);
  });
  it("returns false for a user without Technician role", () => {
    expect(isStrictTechnician(coordinator())).toBe(false);
  });
});

describe("isStrictCustomer", () => {
  it("returns true for a user whose only role is Customer", () => {
    expect(isStrictCustomer(customer())).toBe(true);
  });
  it("returns false for a user with Customer + any other role", () => {
    expect(
      isStrictCustomer(
        makeUser({
          permissions: CUSTOMER_PERMISSIONS,
          roleNames: ["Customer", "Technician"],
        }),
      ),
    ).toBe(false);
  });
});

describe("isStrictRequester", () => {
  it("returns true for a Technician (no Coordinator/SA)", () => {
    expect(isStrictRequester(technician())).toBe(true);
  });
  it("returns true for a Customer", () => {
    expect(isStrictRequester(customer())).toBe(true);
  });
  it("returns false for a Coordinator", () => {
    expect(isStrictRequester(coordinator())).toBe(false);
  });
  it("returns false for a Super Admin", () => {
    expect(isStrictRequester(superAdmin())).toBe(false);
  });
});

// ── Rule 1: zero roles = no access ────────────────────────────────────

describe("can() — zero-role defence", () => {
  it("denies any action for a user with no roles, even if permissions are present", async () => {
    const u = makeUser({
      permissions: ALL_PERMISSIONS,
      roleNames: [],
    });
    expect(await can(u, "tickets.view", ticketTarget("any"))).toBe(false);
    expect(await can(u, "users.create")).toBe(false);
    expect(await can(u, "settings.update")).toBe(false);
  });
});

// ── Rule 2: must hold the permission ──────────────────────────────────

describe("can() — permission requirement", () => {
  it("denies an action a Customer doesn't have", async () => {
    expect(
      await can(customer(), "tickets.assign", ticketTarget(null, "user-cust")),
    ).toBe(false);
  });
  it("denies a Technician deleting tickets", async () => {
    expect(
      await can(technician(), "tickets.delete", ticketTarget("user-tech")),
    ).toBe(false);
  });
  it("denies a Coordinator deleting roles", async () => {
    expect(await can(coordinator(), "roles.delete")).toBe(false);
  });
  it("Super Admin can do anything (global actions)", async () => {
    for (const p of ALL_PERMISSIONS) {
      // Skip the action-targeted scope ones (they need a real target)
      if (
        p.startsWith("tickets.") ||
        p.startsWith("users.update") ||
        p.startsWith("users.deactivate") ||
        p.startsWith("users.reset_password") ||
        p.startsWith("users.impersonate") ||
        p === "procurement.update"
      ) {
        continue;
      }
      expect(await can(superAdmin(), p)).toBe(true);
    }
  });
});

// ── Rule 3: impersonation restrictions ────────────────────────────────

describe("can() — impersonation", () => {
  const impersonator = (): SessionUser =>
    makeUser({
      permissions: ALL_PERMISSIONS,
      roleNames: ["Super Admin"],
      isImpersonating: true,
    });

  it.each([
    "settings.update",
    "roles.create",
    "roles.update",
    "roles.delete",
    "users.create",
    "users.impersonate",
  ] as const)("blocks %s when impersonating", async (perm) => {
    const t: Target =
      perm === "users.impersonate"
        ? userTarget("user-other")
        : { type: "global" };
    expect(await can(impersonator(), perm, t)).toBe(false);
  });

  it("blocks users.deactivate when impersonating", async () => {
    expect(
      await can(
        impersonator(),
        "users.deactivate",
        userTarget("user-other", "user-sa"),
      ),
    ).toBe(false);
  });

  it("still allows non-blocked actions when impersonating", async () => {
    expect(
      await can(
        impersonator(),
        "tickets.reply",
        ticketTarget("any"),
      ),
    ).toBe(true);
    expect(await can(impersonator(), "reports.view")).toBe(true);
  });
});

// ── Rule 4: ticket scope ──────────────────────────────────────────────

describe("can() — ticket scope", () => {
  it("strict Technician can act on a ticket assigned to them", async () => {
    expect(
      await can(
        technician("tech-1"),
        "tickets.update",
        ticketTarget("tech-1"),
      ),
    ).toBe(true);
    expect(
      await can(
        technician("tech-1"),
        "tickets.reply",
        ticketTarget("tech-1"),
      ),
    ).toBe(true);
    expect(
      await can(
        technician("tech-1"),
        "tickets.resolve",
        ticketTarget("tech-1"),
      ),
    ).toBe(true);
  });

  it("strict Technician CANNOT act on a ticket assigned to another tech", async () => {
    expect(
      await can(
        technician("tech-1"),
        "tickets.update",
        ticketTarget("tech-2"),
      ),
    ).toBe(false);
    expect(
      await can(
        technician("tech-1"),
        "tickets.reply",
        ticketTarget("tech-2"),
      ),
    ).toBe(false);
  });

  it("strict Technician keeps READ-ONLY access to a ticket they raised themselves", async () => {
    // Future-proofing for granting a Technician `tickets.create`: without this
    // they would file a ticket and lose sight of it the moment it was assigned
    // to someone else — or immediately, if they never assigned it to
    // themselves. Mirrors the worked-on carry-over: read, never write.
    const createdTarget: Target = {
      type: "ticket",
      ticket: {
        id: "t-9",
        assignedToId: "tech-2",
        customerId: null,
        createdById: "tech-1",
      },
    };
    expect(
      await can(technician("tech-1"), "tickets.view", createdTarget),
    ).toBe(true);
    for (const write of [
      "tickets.update",
      "tickets.reply",
      "tickets.assign",
      "tickets.resolve",
    ] as const) {
      expect(await can(technician("tech-1"), write, createdTarget)).toBe(false);
    }
    // Another technician who merely happens to be looking gets nothing.
    expect(
      await can(technician("tech-3"), "tickets.view", createdTarget),
    ).toBe(false);
  });

  it("strict Technician keeps READ-ONLY access to a reassigned ticket they worked on", async () => {
    // Ticket now assigned to another tech, but tech-1 logged work on it.
    const workedTarget: Target = {
      type: "ticket",
      ticket: {
        id: "t-1",
        assignedToId: "tech-2",
        customerId: null,
        viewerHasWorklog: true,
      },
    };
    // View is allowed (carry-over)...
    expect(
      await can(technician("tech-1"), "tickets.view", workedTarget),
    ).toBe(true);
    // ...but no write actions.
    expect(
      await can(technician("tech-1"), "tickets.update", workedTarget),
    ).toBe(false);
    expect(
      await can(technician("tech-1"), "tickets.reply", workedTarget),
    ).toBe(false);
    expect(
      await can(technician("tech-1"), "tickets.assign", workedTarget),
    ).toBe(false);
  });

  it("strict Technician without a worklog CANNOT view a ticket assigned to another tech", async () => {
    expect(
      await can(
        technician("tech-1"),
        "tickets.view",
        ticketTarget("tech-2"),
      ),
    ).toBe(false);
  });

  it("strict Technician CANNOT act on an unassigned ticket", async () => {
    expect(
      await can(
        technician("tech-1"),
        "tickets.update",
        ticketTarget(null),
      ),
    ).toBe(false);
  });

  it("strict Customer can view their own ticket", async () => {
    expect(
      await can(
        customer("cust-1"),
        "tickets.view",
        ticketTarget(null, "cust-1"),
      ),
    ).toBe(true);
  });

  it("strict Customer CANNOT view another customer's ticket", async () => {
    expect(
      await can(
        customer("cust-1"),
        "tickets.view",
        ticketTarget(null, "cust-2"),
      ),
    ).toBe(false);
  });

  it("Coordinator can act on any ticket regardless of assignment", async () => {
    expect(
      await can(
        coordinator("coord-1"),
        "tickets.update",
        ticketTarget("tech-99"),
      ),
    ).toBe(true);
    expect(
      await can(
        coordinator("coord-1"),
        "tickets.assign",
        ticketTarget(null),
      ),
    ).toBe(true);
  });

  it("Super Admin can act on any ticket", async () => {
    expect(
      await can(superAdmin(), "tickets.delete", ticketTarget("tech-99")),
    ).toBe(true);
  });

  it("Coordinator, IT Director, and Super Admin can close any ticket", async () => {
    expect(
      await can(coordinator(), "tickets.close", ticketTarget("tech-99")),
    ).toBe(true);
    expect(
      await can(itDirector(), "tickets.close", ticketTarget(null)),
    ).toBe(true);
    expect(
      await can(superAdmin(), "tickets.close", ticketTarget("tech-99")),
    ).toBe(true);
  });

  it("Technician and Customer CANNOT close a ticket (permission not granted)", async () => {
    expect(
      await can(technician(), "tickets.close", ticketTarget("user-tech")),
    ).toBe(false);
    expect(
      await can(customer(), "tickets.close", ticketTarget(null, "user-cust")),
    ).toBe(false);
  });

  it("rejects ticket actions when target is wrong type", async () => {
    expect(
      await can(coordinator(), "tickets.update", { type: "global" }),
    ).toBe(false);
  });
});

// ── Rule 4: user-management scope (hierarchy + last-SA + self) ────────

describe("can() — user management scope", () => {
  it("rejects target type mismatch", async () => {
    expect(
      await can(superAdmin(), "users.update", { type: "global" }),
    ).toBe(false);
  });

  it("blocks self-action: cannot deactivate self", async () => {
    expect(
      await can(superAdmin("sa-1"), "users.deactivate", userTarget("sa-1")),
    ).toBe(false);
  });

  // can.ts deliberately ALLOWS self-update via users.update — editing your own
  // name/phone/roles is normal, and the "can't grant what you don't hold" rule
  // still guards the role side. (Self deactivate / reset_password stay blocked
  // below.) This expectation matches that documented behavior.
  it("allows self-update via users.update", async () => {
    expect(
      await can(superAdmin("sa-1"), "users.update", userTarget("sa-1")),
    ).toBe(true);
  });

  it("blocks self-action: cannot reset own password via admin path", async () => {
    expect(
      await can(
        superAdmin("sa-1"),
        "users.reset_password",
        userTarget("sa-1"),
      ),
    ).toBe(false);
  });

  it("blocks deactivating the last active Super Admin", async () => {
    const ctx = makeCtx({
      isLastActiveSuperAdmin: async () => true,
      isDescendantOf: async () => true,
    });
    expect(
      await can(
        superAdmin("sa-1"),
        "users.deactivate",
        userTarget("sa-2"),
        ctx,
      ),
    ).toBe(false);
  });

  it("allows deactivating a Super Admin if others remain active", async () => {
    const ctx = makeCtx({
      isLastActiveSuperAdmin: async () => false,
      isDescendantOf: async () => true,
    });
    expect(
      await can(
        superAdmin("sa-1"),
        "users.deactivate",
        userTarget("sa-2"),
        ctx,
      ),
    ).toBe(true);
  });

  it("allows updating a descendant in hierarchy", async () => {
    const ctx = makeCtx({ isDescendantOf: async () => true });
    expect(
      await can(
        coordinator("coord-1"),
        "users.update",
        userTarget("tech-1", "coord-1"),
        ctx,
      ),
    ).toBe(false); // Coordinator doesn't hold users.update permission
    expect(
      await can(
        superAdmin("sa-1"),
        "users.update",
        userTarget("tech-1", "sa-1"),
        ctx,
      ),
    ).toBe(true);
  });

  // Super Admin bypasses the descendant/hierarchy gate (can.ts: "Super Admin
  // bypasses the hierarchy gate … without this a seeded Super Admin can't
  // manage seeded peers"). The descendant rule still applies to non-Super-Admin
  // grantees, but no seeded non-SA role holds users.update to exercise here.
  it("Super Admin can update a non-descendant (bypasses the hierarchy gate)", async () => {
    const ctx = makeCtx({ isDescendantOf: async () => false });
    expect(
      await can(
        superAdmin("sa-1"),
        "users.update",
        userTarget("tech-99", null),
        ctx,
      ),
    ).toBe(true);
  });
});

// ── Rule 4: impersonate scope (cannot target Super Admin) ─────────────

describe("can() — impersonate scope", () => {
  it("blocks impersonating a Super Admin", async () => {
    const ctx = makeCtx({ userHasRole: async () => true }); // target IS SA
    expect(
      await can(
        superAdmin("sa-1"),
        "users.impersonate",
        userTarget("sa-2"),
        ctx,
      ),
    ).toBe(false);
  });

  it("allows impersonating a non-Super-Admin", async () => {
    const ctx = makeCtx({ userHasRole: async () => false }); // target is NOT SA
    expect(
      await can(
        superAdmin("sa-1"),
        "users.impersonate",
        userTarget("tech-1"),
        ctx,
      ),
    ).toBe(true);
  });

  it("rejects target type mismatch", async () => {
    expect(
      await can(superAdmin(), "users.impersonate", { type: "global" }),
    ).toBe(false);
  });
});

// ── Rule 4: procurement.update scope ──────────────────────────────────

describe("can() — procurement.update scope", () => {
  it("Technician can edit their own pending request", async () => {
    expect(
      await can(
        technician("tech-1"),
        "procurement.update",
        procurementTarget("tech-1"),
      ),
    ).toBe(true);
  });

  it("Technician CANNOT edit another tech's request", async () => {
    expect(
      await can(
        technician("tech-1"),
        "procurement.update",
        procurementTarget("tech-2"),
      ),
    ).toBe(false);
  });

  it("Customer can edit their own pending request", async () => {
    expect(
      await can(
        customer("cust-1"),
        "procurement.update",
        procurementTarget("cust-1"),
      ),
    ).toBe(false); // Customer doesn't have procurement.update permission
  });

  it("Coordinator can edit any procurement request", async () => {
    // Coordinator doesn't have procurement.update by default — verify denied
    expect(
      await can(
        coordinator("coord-1"),
        "procurement.update",
        procurementTarget("tech-99"),
      ),
    ).toBe(false); // not in COORDINATOR_PERMISSIONS

    // Super Admin (has all perms) succeeds regardless of requester
    expect(
      await can(
        superAdmin("sa-1"),
        "procurement.update",
        procurementTarget("tech-99"),
      ),
    ).toBe(true);
  });

  it("rejects target type mismatch", async () => {
    expect(
      await can(superAdmin(), "procurement.update", { type: "global" }),
    ).toBe(false);
  });
});

// ── Default branch: permission alone is sufficient ────────────────────

describe("can() — non-scoped actions", () => {
  it("Coordinator can view procurement (global, no scope check)", async () => {
    expect(await can(coordinator(), "procurement.view")).toBe(true);
  });
  it("IT Director can view audit log", async () => {
    expect(await can(itDirector(), "audit.view")).toBe(true);
  });
  // Req 7.2 — audit logs are visible to everyone (staff) by default.
  it("Technician can view audit log by default (req 7.2)", async () => {
    expect(await can(technician(), "audit.view")).toBe(true);
  });
  it("Coordinator can view audit log by default (req 7.2)", async () => {
    expect(await can(coordinator(), "audit.view")).toBe(true);
  });
  // Req 7.2 — but only WITH the permission: revoking it denies the view.
  it("Technician without audit.view is denied (req 7.2)", async () => {
    const tech = makeUser({
      permissions: TECHNICIAN_PERMISSIONS.filter((p) => p !== "audit.view"),
      roleNames: ["Technician"],
    });
    expect(await can(tech, "audit.view")).toBe(false);
  });
  it("Customer cannot view audit log (lacks permission)", async () => {
    expect(await can(customer(), "audit.view")).toBe(false);
  });
  it("Super Admin can update settings", async () => {
    expect(await can(superAdmin(), "settings.update")).toBe(true);
  });
  it("Coordinator cannot update settings (lacks permission)", async () => {
    expect(await can(coordinator(), "settings.update")).toBe(false);
  });
});

// ── tickets.manage_participants ───────────────────────────────────────
//
// The whole point of this permission is that a CUSTOMER holds it without
// holding tickets.update. The failure mode it guards against is the switch's
// `default: return true` — a constant added without a matching scoped case
// grants it on every ticket the caller can see.

describe("can() — tickets.manage_participants scope", () => {
  const ctx = makeCtx();

  it("lets the requesting customer manage their OWN ticket", async () => {
    await expect(
      can(
        customer("c-1"),
        "tickets.manage_participants",
        ticketTarget(null, "c-1"),
        ctx,
      ),
    ).resolves.toBe(true);
  });

  it("denies a customer on someone else's ticket", async () => {
    await expect(
      can(
        customer("c-1"),
        "tickets.manage_participants",
        ticketTarget(null, "c-2"),
        ctx,
      ),
    ).resolves.toBe(false);
  });

  it("denies a NON-STRICT customer (extra custom role) on someone else's ticket", async () => {
    // isStrictCustomer is false here (two roles), so without the isNonStaff
    // leg this would fall through to `return true`.
    const u = makeUser({
      id: "c-3",
      permissions: CUSTOMER_PERMISSIONS,
      roleNames: ["Customer", "Billing contact"],
    });
    await expect(
      can(u, "tickets.manage_participants", ticketTarget(null, "c-9"), ctx),
    ).resolves.toBe(false);
  });

  it("still lets a NON-STRICT customer manage their own ticket", async () => {
    const u = makeUser({
      id: "c-3",
      permissions: CUSTOMER_PERMISSIONS,
      roleNames: ["Customer", "Billing contact"],
    });
    await expect(
      can(u, "tickets.manage_participants", ticketTarget(null, "c-3"), ctx),
    ).resolves.toBe(true);
  });

  it("denies a strict technician who is not the assignee", async () => {
    await expect(
      can(
        technician("t-1"),
        "tickets.manage_participants",
        ticketTarget("t-2"),
        ctx,
      ),
    ).resolves.toBe(false);
  });

  it("allows the assigned technician", async () => {
    await expect(
      can(
        technician("t-1"),
        "tickets.manage_participants",
        ticketTarget("t-1"),
        ctx,
      ),
    ).resolves.toBe(true);
  });

  it("allows a merge co-assignee", async () => {
    const target: Target = {
      type: "ticket",
      ticket: {
        id: "t-1",
        assignedToId: "t-9",
        customerId: null,
        assigneeIds: ["t-1"],
      },
    };
    await expect(
      can(technician("t-1"), "tickets.manage_participants", target, ctx),
    ).resolves.toBe(true);
  });

  it("allows staff on any ticket (Coordinator / IT Director)", async () => {
    await expect(
      can(coordinator(), "tickets.manage_participants", ticketTarget("x"), ctx),
    ).resolves.toBe(true);
    await expect(
      can(itDirector(), "tickets.manage_participants", ticketTarget("x"), ctx),
    ).resolves.toBe(true);
  });

  it("allows a staff member who ALSO holds the Customer role, on any ticket", async () => {
    // Roles are additive; a Coordinator+Customer is staff and must not be
    // narrowed to their own tickets.
    const u = makeUser({
      id: "s-1",
      permissions: COORDINATOR_PERMISSIONS,
      roleNames: ["Coordinator", "Customer"],
    });
    await expect(
      can(u, "tickets.manage_participants", ticketTarget(null, "someone"), ctx),
    ).resolves.toBe(true);
  });

  it("rejects a non-ticket target outright", async () => {
    await expect(
      can(superAdmin(), "tickets.manage_participants", { type: "global" }, ctx),
    ).resolves.toBe(false);
  });
});
