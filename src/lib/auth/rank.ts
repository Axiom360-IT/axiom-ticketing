// ── Role rank: who outranks whom ──────────────────────────────────────
//
// Three ranks in code; every other distinction is a role, because roles are
// already data. A named tier in code is what you add when roles are NOT data.
//
//   2  Technical Lead   holds everything; nothing in the app can edit it
//   1  Super Admin      whatever the Technical Lead leaves it
//   0  everyone else   Coordinator, Technician, Customer, anything custom
//
// THE rule, and the only one this module exists to state:
//
//     you may change a role (edit it, delete it, grant it, take it away)
//     only if your rank is STRICTLY HIGHER than the role's.
//
// "Strictly" is the point. It means a Super Admin cannot edit the Super Admin
// role, cannot make another Super Admin, and cannot remove the role from one —
// no Super Admin can edit another. And since nothing outranks 2, the
// Technical Lead role is immutable from inside the app; a script manages it.
//
// This closes a hole the older delegation rule leaves open. "You can't grant
// what you don't hold" blocks escalating UPWARD. It does nothing about
// reaching DOWN-and-across: a Super Admin holding roles.update could open the
// Technical Lead's role and strip it, and since they would be granting
// themselves nothing, the delegation guard would never fire.
//
// Pure: no database, no imports from can.ts (which imports this). The few
// things that need the database live in role-authority.ts.

/** The names the built-in tiers go by. Every other file refers to these
 *  constants, never to the string — see rank.test.ts, which fails if a
 *  literal creeps back in. */
export const SUPER_ADMIN_ROLE = "Super Admin";
export const TECHNICAL_LEAD_ROLE = "Technical Lead";

export const RANK = {
  STAFF: 0,
  SUPER_ADMIN: 1,
  TECHNICAL_LEAD: 2,
} as const;

export const MAX_RANK = RANK.TECHNICAL_LEAD;

/**
 * Roles whose holders are INTERNAL STAFF rather than customers.
 *
 * Six places used to keep their own copy of this list (the portal redirect,
 * ticket stream classification, the users list audience, its CSV export, the
 * customer-import duplicate check and the org-colleague query). Each would
 * have needed the new role added by hand, and the failure for forgetting one
 * is quiet and wrong: an account holding only the Technical Lead role would
 * be treated as an external customer.
 */
export const STAFF_ROLE_NAMES: readonly string[] = [
  SUPER_ADMIN_ROLE,
  TECHNICAL_LEAD_ROLE,
  "IT Director",
  "Coordinator",
  "Technician",
];

/**
 * Roles that see every ticket (not just their own queue).
 * Same list minus Technician, who is scoped to what they own.
 */
export const ELEVATED_ROLE_NAMES: readonly string[] = STAFF_ROLE_NAMES.filter(
  (r) => r !== "Technician",
);

type Ranked = { rank?: number; roleNames: ReadonlySet<string> };

/**
 * A user's rank: the highest rank among their roles.
 *
 * `rank` is filled from the database by the session loader. The role-name
 * floor below is deliberate belt and braces rather than a second source of
 * truth: it keeps a Super Admin a Super Admin if `roles.rank` has not been
 * migrated yet, in a test fixture that never set it, or if someone zeroes the
 * column by hand. It can only RAISE the result, never lower it, so it cannot
 * be used to demote anyone.
 */
export function rankOf(user: Ranked): number {
  let rank = user.rank ?? RANK.STAFF;
  if (user.roleNames.has(TECHNICAL_LEAD_ROLE)) rank = Math.max(rank, RANK.TECHNICAL_LEAD);
  if (user.roleNames.has(SUPER_ADMIN_ROLE)) rank = Math.max(rank, RANK.SUPER_ADMIN);
  return rank;
}

/** Super Admin or above. The replacement for `roleNames.has("Super Admin")`
 *  wherever the question is "may this person do administrative things". */
export function isAtLeastSuperAdmin(user: Ranked): boolean {
  return rankOf(user) >= RANK.SUPER_ADMIN;
}

/** The whole rule. */
export function canManageRank(actorRank: number, targetRank: number): boolean {
  return actorRank > targetRank;
}

// ── Role membership changes ───────────────────────────────────────────

export type RoleRankInfo = { id: string; rank: number };

/** What changes when a user's role set goes from `before` to `after`. */
export function roleSetChanges(
  before: readonly string[],
  after: readonly string[],
): { added: string[]; removed: string[] } {
  const b = new Set(before);
  const a = new Set(after);
  return {
    added: [...a].filter((id) => !b.has(id)),
    removed: [...b].filter((id) => !a.has(id)),
  };
}

/**
 * The roles in a membership CHANGE that the actor has no authority over.
 *
 * Only roles actually being added or removed count. A role the user already
 * holds and keeps is untouched, so a Super Admin can still edit another
 * Super Admin's name or phone number through a form that resubmits their
 * existing roles — what they cannot do is make or unmake one.
 *
 * Roles missing from `known` are treated as rank 0: a deleted or unknown id
 * is not a reason to refuse, and the FK on user_roles rejects it anyway.
 */
export function roleChangesAboveAuthority(
  actorRank: number,
  before: readonly string[],
  after: readonly string[],
  known: readonly RoleRankInfo[],
): string[] {
  const rankById = new Map(known.map((r) => [r.id, r.rank]));
  const { added, removed } = roleSetChanges(before, after);
  return [...added, ...removed].filter(
    (id) => !canManageRank(actorRank, rankById.get(id) ?? RANK.STAFF),
  );
}

// ── What a picker should offer ────────────────────────────────────────

/** Why a role cannot be handed out by this caller, or `ok`. */
export type RoleAssignability = "ok" | "rank" | "permissions";

/**
 * Can the caller assign this role?
 *
 * Two independent reasons it might not be allowed, and the picker needs to
 * tell them apart only for ordering the checks: rank first, because "you
 * outrank this role" is the stronger statement.
 */
export function roleAssignability(input: {
  callerRank: number;
  callerPermissions: ReadonlySet<string>;
  callerHasAll: boolean;
  role: { rank: number; permissions: readonly string[] };
}): RoleAssignability {
  if (!canManageRank(input.callerRank, input.role.rank)) return "rank";
  if (input.callerHasAll) return "ok";
  return input.role.permissions.every((p) => input.callerPermissions.has(p))
    ? "ok"
    : "permissions";
}

// ── The visibility policy ─────────────────────────────────────────────

/**
 * What a restricted admin sees for something they cannot delegate.
 *
 *   hidden  nothing. The row is simply absent, and there is no count or
 *           "show locked" link to hint it exists. DEFAULT — if people can see
 *           a capability they cannot have, they ask for it.
 *   locked  the row, greyed out, with a lock and the name of who to ask.
 *
 * Set by the Technical Lead alone (`permissions.undelegable_display` is a
 * technical-tier setting).
 */
export type UndelegableDisplay = "hidden" | "locked";

export const DEFAULT_UNDELEGABLE_DISPLAY: UndelegableDisplay = "hidden";

export function parseUndelegableDisplay(v: unknown): UndelegableDisplay {
  return v === "locked" ? "locked" : DEFAULT_UNDELEGABLE_DISPLAY;
}
