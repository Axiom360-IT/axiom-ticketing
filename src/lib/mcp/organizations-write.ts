import "server-only";
import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can, type SessionUser } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { db, transactional } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { organizationDomains, organizations } from "@/lib/db/schema/organizations";
import { tickets } from "@/lib/db/schema/tickets";
import { notifyBalanceChanged } from "@/lib/billing/events";
import {
  ABBREVIATION_RE,
  abbreviationTaken,
  conflictingDomains,
  hoursToMinutes,
  nameTaken,
  normalizeAbbreviation,
  normalizeDomains,
} from "@/lib/organizations/validation";

// Mirrors app/actions/organizations.ts's mutating actions, adapted to take
// an explicit SessionUser and to look organizations up by NAME instead of
// uuid.

type Result = { ok: true; [k: string]: unknown } | { ok: false; error: string };

async function findOrgByName(name: string) {
  const [row] = await db.select().from(organizations).where(eq(organizations.name, name)).limit(1);
  return row ?? null;
}

// ── create_organization ────────────────────────────────────────────────
// Mirrors createOrganization (app/actions/organizations.ts ~245-338).
export async function createOrganizationViaMcp(
  user: SessionUser,
  input: {
    name: string;
    abbreviation: string;
    isMonthlyPlan?: boolean;
    monthlyHoursIncluded?: number;
    contractNotes?: string;
    emailDomains?: string[];
  },
): Promise<Result> {
  if (!(await can(user, "organizations.create", { type: "global" }, productionContext))) {
    return { ok: false, error: "You don't have permission to create organizations." };
  }

  const abbreviation = normalizeAbbreviation(input.abbreviation);
  if (!ABBREVIATION_RE.test(abbreviation)) {
    return { ok: false, error: "Abbreviation must be 2–5 letters or digits." };
  }
  if (await nameTaken(input.name)) return { ok: false, error: "An organization with that name already exists." };
  if (await abbreviationTaken(abbreviation)) return { ok: false, error: `Abbreviation "${abbreviation}" is already in use.` };

  const isMonthlyPlan = input.isMonthlyPlan ?? false;
  if (isMonthlyPlan && (input.monthlyHoursIncluded == null || input.monthlyHoursIncluded <= 0)) {
    return { ok: false, error: "Enter the monthly included hours for a monthly-plan organization." };
  }
  const minutesIncluded = isMonthlyPlan ? hoursToMinutes(input.monthlyHoursIncluded) : null;
  const minutesBalance = isMonthlyPlan ? minutesIncluded : null;

  let domains: string[];
  try {
    domains = normalizeDomains(input.emailDomains);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid domain." };
  }
  const clash = await conflictingDomains(domains);
  if (clash.length > 0) return { ok: false, error: `${clash.join(", ")} already linked to another organization.` };

  const [row] = await db
    .insert(organizations)
    .values({
      name: input.name,
      abbreviation,
      isMonthlyPlan,
      monthlyMinutesIncluded: minutesIncluded,
      monthlyMinutesBalance: minutesBalance,
      monthlyPlanResetAt: isMonthlyPlan ? new Date() : null,
      contractNotes: input.contractNotes || null,
      isActive: true,
      createdById: user.id,
    })
    .returning({ id: organizations.id });

  if (domains.length > 0) {
    await db.insert(organizationDomains).values(domains.map((domain) => ({ organizationId: row.id, domain })));
  }

  await audit({
    actorId: user.id,
    action: "organization.create",
    targetType: "organization",
    targetId: row.id,
    after: { name: input.name, abbreviation, isMonthlyPlan, via: "mcp" },
  });

  return { ok: true, organizationId: row.id };
}

// ── update_organization ────────────────────────────────────────────────
// Mirrors updateOrganization (app/actions/organizations.ts ~345-479).
export async function updateOrganizationViaMcp(
  user: SessionUser,
  organizationName: string,
  changes: {
    name?: string;
    abbreviation?: string;
    isMonthlyPlan?: boolean;
    monthlyHoursIncluded?: number | null;
    contractNotes?: string;
    emailDomains?: string[];
    isActive?: boolean;
  },
): Promise<Result> {
  if (!(await can(user, "organizations.update", { type: "global" }, productionContext))) {
    return { ok: false, error: "You don't have permission to update organizations." };
  }
  const org = await findOrgByName(organizationName);
  if (!org) return { ok: false, error: `No organization found named "${organizationName}".` };

  const set: Partial<typeof organizations.$inferInsert> = { updatedAt: new Date() };

  if (changes.name !== undefined) {
    if (await nameTaken(changes.name, org.id)) return { ok: false, error: "An organization with that name already exists." };
    set.name = changes.name;
  }
  if (changes.abbreviation !== undefined) {
    const abbreviation = normalizeAbbreviation(changes.abbreviation);
    if (!ABBREVIATION_RE.test(abbreviation)) return { ok: false, error: "Abbreviation must be 2–5 letters or digits." };
    if (await abbreviationTaken(abbreviation, org.id)) return { ok: false, error: `Abbreviation "${abbreviation}" is already in use.` };
    set.abbreviation = abbreviation;
  }

  const isMonthlyPlan = changes.isMonthlyPlan ?? org.isMonthlyPlan;
  if (changes.isMonthlyPlan !== undefined) set.isMonthlyPlan = changes.isMonthlyPlan;
  if (!isMonthlyPlan) {
    if (changes.isMonthlyPlan === false) {
      set.monthlyMinutesIncluded = null;
      set.monthlyMinutesBalance = null;
      set.monthlyPlanResetAt = null;
      set.negativeBalanceAlertedAt = null;
    }
  } else {
    if (changes.monthlyHoursIncluded !== undefined) {
      set.monthlyMinutesIncluded = hoursToMinutes(changes.monthlyHoursIncluded);
    }
    if (!org.isMonthlyPlan) {
      set.monthlyMinutesBalance = set.monthlyMinutesIncluded ?? org.monthlyMinutesIncluded ?? null;
      set.monthlyPlanResetAt = new Date();
      set.negativeBalanceAlertedAt = null;
    }
    const effectiveIncluded = set.monthlyMinutesIncluded !== undefined ? set.monthlyMinutesIncluded : org.monthlyMinutesIncluded;
    if (effectiveIncluded == null || effectiveIncluded <= 0) {
      return { ok: false, error: "Enter the monthly included hours for a monthly-plan organization." };
    }
  }
  if (changes.contractNotes !== undefined) set.contractNotes = changes.contractNotes || null;
  if (changes.isActive !== undefined) set.isActive = changes.isActive;

  let domains: string[] | null = null;
  if (changes.emailDomains !== undefined) {
    try {
      domains = normalizeDomains(changes.emailDomains);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Invalid domain." };
    }
    const clash = await conflictingDomains(domains, org.id);
    if (clash.length > 0) return { ok: false, error: `${clash.join(", ")} already linked to another organization.` };
  }

  await transactional(async (tx) => {
    await tx.update(organizations).set(set).where(eq(organizations.id, org.id));
    if (domains !== null) {
      await tx.delete(organizationDomains).where(eq(organizationDomains.organizationId, org.id));
      if (domains.length > 0) {
        await tx.insert(organizationDomains).values(domains.map((domain) => ({ organizationId: org.id, domain })));
      }
    }
  });

  await audit({
    actorId: user.id,
    action: "organization.update",
    targetType: "organization",
    targetId: org.id,
    before: {
      name: org.name,
      abbreviation: org.abbreviation,
      isMonthlyPlan: org.isMonthlyPlan,
      isActive: org.isActive,
    },
    after: { ...set, via: "mcp" },
  });

  return { ok: true };
}

// ── add_organization_hours ────────────────────────────────────────────
// Mirrors addOrganizationHours (app/actions/organizations.ts ~493-549).
// Additive-only top-up of the monthly balance — req 8.3.
export async function addOrganizationHoursViaMcp(
  user: SessionUser,
  organizationName: string,
  hours: number,
): Promise<Result> {
  if (!(hours > 0) || hours > 100000) return { ok: false, error: "Enter a positive number of hours." };
  if (!(await can(user, "organizations.update", { type: "global" }, productionContext))) {
    return { ok: false, error: "You don't have permission to update organizations." };
  }
  const org = await findOrgByName(organizationName);
  if (!org) return { ok: false, error: `No organization found named "${organizationName}".` };
  if (!org.isMonthlyPlan) return { ok: false, error: "This organization is not on a monthly plan." };

  const addMinutes = hoursToMinutes(hours) ?? 0;
  const newBalance = (org.monthlyMinutesBalance ?? 0) + addMinutes;

  await db.update(organizations).set({ monthlyMinutesBalance: newBalance, updatedAt: new Date() }).where(eq(organizations.id, org.id));

  await audit({
    actorId: user.id,
    action: "organization.add_hours",
    targetType: "organization",
    targetId: org.id,
    before: { monthlyMinutesBalance: org.monthlyMinutesBalance },
    after: { monthlyMinutesBalance: newBalance, addedMinutes: addMinutes, via: "mcp" },
  });

  await notifyBalanceChanged([org.id]);

  return { ok: true, newBalanceMinutes: newBalance };
}

// ── delete_organization ────────────────────────────────────────────────
// Mirrors deleteOrganization (app/actions/organizations.ts ~553-596). Hard
// delete, but refused while any ticket or user still references the org.
export async function deleteOrganizationViaMcp(user: SessionUser, organizationName: string): Promise<Result> {
  if (!(await can(user, "organizations.delete", { type: "global" }, productionContext))) {
    return { ok: false, error: "You don't have permission to delete organizations." };
  }
  const org = await findOrgByName(organizationName);
  if (!org) return { ok: false, error: `No organization found named "${organizationName}".` };

  const [{ value: ticketRefs }] = await db.select({ value: count() }).from(tickets).where(eq(tickets.organizationId, org.id));
  const [{ value: userRefs }] = await db.select({ value: count() }).from(users).where(eq(users.organizationId, org.id));
  if (ticketRefs > 0 || userRefs > 0) {
    return {
      ok: false,
      error: `Organization is referenced by ${ticketRefs} ticket(s) and ${userRefs} user(s) — deactivate it instead (update_organization with isActive: false).`,
    };
  }

  await db.delete(organizations).where(eq(organizations.id, org.id));
  await audit({
    actorId: user.id,
    action: "organization.delete",
    targetType: "organization",
    targetId: org.id,
    before: { name: org.name },
    after: { via: "mcp" },
  });

  return { ok: true };
}

// ── MCP tool registration ────────────────────────────────────────────────

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
const CONFIRM_NOTE =
  " Before calling this, always show the user exactly what will change and get their explicit go-ahead in the chat first — never call this on the first ask.";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerOrganizationWriteTools(server: any, user: SessionUser): void {
  server.registerTool(
    "create_organization",
    {
      title: "Create an organization",
      description: "Creates a new client/internal organization, optionally on a monthly hours plan with registered email domains." + CONFIRM_NOTE,
      inputSchema: {
        name: z.string().min(1),
        abbreviation: z.string().min(2).max(5),
        isMonthlyPlan: z.boolean().optional(),
        monthlyHoursIncluded: z.number().positive().optional(),
        contractNotes: z.string().optional(),
        emailDomains: z.array(z.string()).optional(),
      },
    },
    async (input: {
      name: string;
      abbreviation: string;
      isMonthlyPlan?: boolean;
      monthlyHoursIncluded?: number;
      contractNotes?: string;
      emailDomains?: string[];
    }) => {
      const r = await createOrganizationViaMcp(user, input);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "update_organization",
    {
      title: "Update an organization",
      description: "Updates an organization's name, abbreviation, monthly-plan settings, contract notes, domains, or active status (by name)." + CONFIRM_NOTE,
      inputSchema: {
        organizationName: z.string().min(1),
        name: z.string().optional(),
        abbreviation: z.string().optional(),
        isMonthlyPlan: z.boolean().optional(),
        monthlyHoursIncluded: z.number().nullable().optional(),
        contractNotes: z.string().optional(),
        emailDomains: z.array(z.string()).optional(),
        isActive: z.boolean().optional(),
      },
    },
    async (input: {
      organizationName: string;
      name?: string;
      abbreviation?: string;
      isMonthlyPlan?: boolean;
      monthlyHoursIncluded?: number | null;
      contractNotes?: string;
      emailDomains?: string[];
      isActive?: boolean;
    }) => {
      const { organizationName, ...changes } = input;
      const r = await updateOrganizationViaMcp(user, organizationName, changes);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "add_organization_hours",
    {
      title: "Top up an organization's monthly hours",
      description: "Adds hours to a monthly-plan organization's balance (additive only — this is the only way to manually adjust it)." + CONFIRM_NOTE,
      inputSchema: { organizationName: z.string().min(1), hours: z.number().positive() },
    },
    async ({ organizationName, hours }: { organizationName: string; hours: number }) => {
      const r = await addOrganizationHoursViaMcp(user, organizationName, hours);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );

  server.registerTool(
    "delete_organization",
    {
      title: "Delete an organization",
      description: "Permanently deletes an organization. Refused if any ticket or user still references it — deactivate it instead in that case." + CONFIRM_NOTE,
      inputSchema: { organizationName: z.string().min(1) },
    },
    async ({ organizationName }: { organizationName: string }) => {
      const r = await deleteOrganizationViaMcp(user, organizationName);
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );
}
