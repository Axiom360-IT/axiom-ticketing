"use server";
import { and, count, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { requireSessionUser } from "@/lib/auth/session";
import { db, transactional } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import {
  organizationDomains,
  organizations,
} from "@/lib/db/schema/organizations";
import { tickets } from "@/lib/db/schema/tickets";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { enforceUserRateLimit } from "@/lib/ratelimit";
import { syncMonthlyPlanDeduction } from "@/lib/tickets/billing";

// Abbreviation: 2–5 upper-case alphanumerics. Used as the ticket-number prefix
// (e.g. "KI" → KI-20260522-001), so it is normalised before validation.
const ABBREVIATION_RE = /^[A-Z0-9]{2,5}$/;

function normalizeAbbreviation(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 5);
}

/** Convert an optional decimal-hours input to whole minutes, or null. */
function hoursToMinutes(hours: number | null | undefined): number | null {
  if (hours === null || hours === undefined) return null;
  return Math.round(hours * 60);
}

// Bare email domain, e.g. "kingsmill.com" (matches the DB CHECK on
// organization_domains.domain).
const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;

/**
 * Normalise free-text domain entries (one per line / comma separated, possibly
 * pasted as "@kingsmill.com", "https://kingsmill.com", or an email) down to
 * unique, lower-cased bare domains. Throws a friendly Error on a bad entry.
 */
function normalizeDomains(input: string[] | undefined): string[] {
  if (!input) return [];
  const out = new Set<string>();
  for (const raw of input) {
    let d = raw.trim().toLowerCase();
    if (!d) continue;
    if (d.includes("@")) d = d.slice(d.lastIndexOf("@") + 1); // strip email/local
    d = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^@/, "");
    if (!DOMAIN_RE.test(d)) {
      throw new Error(`"${raw.trim()}" is not a valid email domain.`);
    }
    out.add(d);
  }
  return [...out];
}

/** Domains in `domains` already owned by a DIFFERENT org (would be ambiguous). */
async function conflictingDomains(
  domains: string[],
  excludeOrgId?: string,
): Promise<string[]> {
  if (domains.length === 0) return [];
  const rows = await db
    .select({ domain: organizationDomains.domain })
    .from(organizationDomains)
    .where(
      excludeOrgId
        ? and(
            inArray(organizationDomains.domain, domains),
            ne(organizationDomains.organizationId, excludeOrgId),
          )
        : inArray(organizationDomains.domain, domains),
    );
  return rows.map((r) => r.domain);
}

const baseSchema = z.object({
  name: z.string().trim().min(1).max(160),
  abbreviation: z.string().trim().min(1).max(20),
  isMonthlyPlan: z.boolean().default(false),
  // Decimal hours from the form (e.g. 20 or 12.5). Stored as integer minutes.
  monthlyHoursIncluded: z.number().min(0).max(100000).nullable().optional(),
  monthlyHoursBalance: z.number().min(0).max(100000).nullable().optional(),
  contractNotes: z.string().trim().max(2000).optional(),
  // Email domains that identify this org's people (the guest-ticket matcher).
  emailDomains: z.array(z.string()).max(50).optional(),
  isActive: z.boolean().default(true),
});

export type CreateOrganizationInput = z.infer<typeof baseSchema>;
export type OrganizationActionResult =
  | { ok: true; organizationId: string }
  | { ok: false; error: string };

async function abbreviationTaken(abbrev: string, excludeId?: string) {
  const [row] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(
      excludeId
        ? and(
            eq(organizations.abbreviation, abbrev),
            ne(organizations.id, excludeId),
          )
        : eq(organizations.abbreviation, abbrev),
    )
    .limit(1);
  return Boolean(row);
}

async function nameTaken(name: string, excludeId?: string) {
  const [row] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(
      excludeId
        ? and(
            sql`lower(${organizations.name}) = lower(${name})`,
            ne(organizations.id, excludeId),
          )
        : sql`lower(${organizations.name}) = lower(${name})`,
    )
    .limit(1);
  return Boolean(row);
}

// ── createOrganization ─────────────────────────────────────────────

export async function createOrganization(
  input: CreateOrganizationInput,
): Promise<OrganizationActionResult> {
  const parsed = baseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;
  const caller = await requireSessionUser();
  await enforceUserRateLimit("authManageOrganization", caller.id);
  if (
    !(await can(caller, "organizations.create", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }

  const abbreviation = normalizeAbbreviation(data.abbreviation);
  if (!ABBREVIATION_RE.test(abbreviation)) {
    return { ok: false, error: "Abbreviation must be 2–5 letters or digits." };
  }
  if (await nameTaken(data.name)) {
    return { ok: false, error: "An organization with that name already exists." };
  }
  if (await abbreviationTaken(abbreviation)) {
    return { ok: false, error: `Abbreviation "${abbreviation}" is already in use.` };
  }

  const minutesIncluded = data.isMonthlyPlan
    ? hoursToMinutes(data.monthlyHoursIncluded)
    : null;
  // Balance defaults to the included amount on creation when not given.
  const minutesBalance = data.isMonthlyPlan
    ? (hoursToMinutes(data.monthlyHoursBalance) ?? minutesIncluded)
    : null;

  let domains: string[];
  try {
    domains = normalizeDomains(data.emailDomains);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid domain." };
  }
  const clash = await conflictingDomains(domains);
  if (clash.length > 0) {
    return {
      ok: false,
      error: `${clash.join(", ")} already linked to another organization.`,
    };
  }

  const [row] = await db
    .insert(organizations)
    .values({
      name: data.name,
      abbreviation,
      isMonthlyPlan: data.isMonthlyPlan,
      monthlyMinutesIncluded: minutesIncluded,
      monthlyMinutesBalance: minutesBalance,
      contractNotes: data.contractNotes || null,
      isActive: data.isActive,
      createdById: caller.id,
    })
    .returning({ id: organizations.id });

  if (domains.length > 0) {
    await db
      .insert(organizationDomains)
      .values(domains.map((domain) => ({ organizationId: row.id, domain })));
  }

  await audit({
    actorId: caller.id,
    action: "organization.create",
    targetType: "organization",
    targetId: row.id,
    after: { name: data.name, abbreviation, isMonthlyPlan: data.isMonthlyPlan },
  });

  revalidatePath("/admin/organizations");
  return { ok: true, organizationId: row.id };
}

// ── updateOrganization ─────────────────────────────────────────────

const updateSchema = baseSchema.partial();
export type UpdateOrganizationInput = z.infer<typeof updateSchema>;

export async function updateOrganization(
  organizationId: string,
  input: UpdateOrganizationInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;
  const caller = await requireSessionUser();
  await enforceUserRateLimit("authManageOrganization", caller.id);
  if (
    !(await can(caller, "organizations.update", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) throw new NotFoundError();

  const set: Partial<typeof organizations.$inferInsert> = { updatedAt: new Date() };

  if (data.name !== undefined) {
    if (await nameTaken(data.name, organizationId)) {
      return { ok: false, error: "An organization with that name already exists." };
    }
    set.name = data.name;
  }
  if (data.abbreviation !== undefined) {
    const abbreviation = normalizeAbbreviation(data.abbreviation);
    if (!ABBREVIATION_RE.test(abbreviation)) {
      return { ok: false, error: "Abbreviation must be 2–5 letters or digits." };
    }
    if (await abbreviationTaken(abbreviation, organizationId)) {
      return { ok: false, error: `Abbreviation "${abbreviation}" is already in use.` };
    }
    set.abbreviation = abbreviation;
  }

  const isMonthlyPlan = data.isMonthlyPlan ?? org.isMonthlyPlan;
  if (data.isMonthlyPlan !== undefined) set.isMonthlyPlan = data.isMonthlyPlan;
  if (!isMonthlyPlan) {
    // Clear contract figures when the org is no longer on a monthly plan.
    if (data.isMonthlyPlan === false) {
      set.monthlyMinutesIncluded = null;
      set.monthlyMinutesBalance = null;
    }
  } else {
    if (data.monthlyHoursIncluded !== undefined) {
      set.monthlyMinutesIncluded = hoursToMinutes(data.monthlyHoursIncluded);
    }
    if (data.monthlyHoursBalance !== undefined) {
      set.monthlyMinutesBalance = hoursToMinutes(data.monthlyHoursBalance);
    }
  }
  if (data.contractNotes !== undefined) set.contractNotes = data.contractNotes || null;
  if (data.isActive !== undefined) set.isActive = data.isActive;

  // Resolve the new domain set (when the form sent one) before any writes, so
  // a bad/clashing domain fails the whole update cleanly.
  let domains: string[] | null = null;
  if (data.emailDomains !== undefined) {
    try {
      domains = normalizeDomains(data.emailDomains);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Invalid domain." };
    }
    const clash = await conflictingDomains(domains, organizationId);
    if (clash.length > 0) {
      return {
        ok: false,
        error: `${clash.join(", ")} already linked to another organization.`,
      };
    }
  }

  await transactional(async (tx) => {
    await tx.update(organizations).set(set).where(eq(organizations.id, organizationId));
    if (domains !== null) {
      // Replace the org's domain set atomically.
      await tx
        .delete(organizationDomains)
        .where(eq(organizationDomains.organizationId, organizationId));
      if (domains.length > 0) {
        await tx
          .insert(organizationDomains)
          .values(domains.map((domain) => ({ organizationId, domain })));
      }
    }
  });

  await audit({
    actorId: caller.id,
    action: "organization.update",
    targetType: "organization",
    targetId: organizationId,
    before: {
      name: org.name,
      abbreviation: org.abbreviation,
      isMonthlyPlan: org.isMonthlyPlan,
      monthlyMinutesIncluded: org.monthlyMinutesIncluded,
      monthlyMinutesBalance: org.monthlyMinutesBalance,
      isActive: org.isActive,
    },
    after: set,
  });

  revalidatePath("/admin/organizations");
  revalidatePath(`/admin/organizations/${organizationId}`);
  return { ok: true };
}

// ── deleteOrganization ─────────────────────────────────────────────

export async function deleteOrganization(
  organizationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await requireSessionUser();
  if (
    !(await can(caller, "organizations.delete", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }
  const [org] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) throw new NotFoundError();

  // Refuse to delete while tickets or users still reference the org — the FK
  // would null them out and lose the linkage. Deactivate instead.
  const [{ value: ticketRefs }] = await db
    .select({ value: count() })
    .from(tickets)
    .where(eq(tickets.organizationId, organizationId));
  const [{ value: userRefs }] = await db
    .select({ value: count() })
    .from(users)
    .where(eq(users.organizationId, organizationId));
  if (ticketRefs > 0 || userRefs > 0) {
    return {
      ok: false,
      error: `Organization is referenced by ${ticketRefs} ticket(s) and ${userRefs} user(s). Deactivate it instead.`,
    };
  }

  await db.delete(organizations).where(eq(organizations.id, organizationId));
  await audit({
    actorId: caller.id,
    action: "organization.delete",
    targetType: "organization",
    targetId: organizationId,
    before: { name: org.name },
  });
  revalidatePath("/admin/organizations");
  return { ok: true };
}

// ── Read helpers ───────────────────────────────────────────────────

export async function listOrganizationsForAdmin() {
  const caller = await requireSessionUser();
  if (
    !(await can(caller, "organizations.view", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      abbreviation: organizations.abbreviation,
      isMonthlyPlan: organizations.isMonthlyPlan,
      monthlyMinutesIncluded: organizations.monthlyMinutesIncluded,
      monthlyMinutesBalance: organizations.monthlyMinutesBalance,
      isActive: organizations.isActive,
    })
    .from(organizations)
    .orderBy(organizations.name);
  return rows;
}

export async function getOrganizationDetail(organizationId: string) {
  const caller = await requireSessionUser();
  if (
    !(await can(caller, "organizations.view", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) return null;
  const domainRows = await db
    .select({ domain: organizationDomains.domain })
    .from(organizationDomains)
    .where(eq(organizationDomains.organizationId, organizationId))
    .orderBy(organizationDomains.domain);
  return { ...org, emailDomains: domainRows.map((d) => d.domain) };
}

/** Active organizations for staff dropdowns (e.g. create-on-behalf). */
export async function listActiveOrganizations() {
  const caller = await requireSessionUser();
  if (
    !(await can(caller, "organizations.view", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }
  return db
    .select({
      id: organizations.id,
      name: organizations.name,
      abbreviation: organizations.abbreviation,
    })
    .from(organizations)
    .where(eq(organizations.isActive, true))
    .orderBy(organizations.name);
}

// ── Organization triage (unverified org claims) ────────────────────
//
// Tickets whose submitter typed a company we couldn't confirm by email domain
// land here (org_match_status = 'unverified', organizationId NULL) so a
// coordinator can link them to the right org — or create a new one.

/** Gate for triage actions: managing org attribution is a coordinator+ task. */
async function requireOrgTriage() {
  const caller = await requireSessionUser();
  if (
    !(await can(
      caller,
      "organizations.update",
      { type: "global" },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }
  return caller;
}

export async function listUnverifiedOrgTickets() {
  await requireOrgTriage();
  return db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      customerName: tickets.customerName,
      customerEmail: tickets.customerEmail,
      customerCompany: tickets.customerCompany,
      createdAt: tickets.createdAt,
    })
    .from(tickets)
    .where(
      and(eq(tickets.orgMatchStatus, "unverified"), isNull(tickets.deletedAt)),
    )
    .orderBy(desc(tickets.createdAt))
    .limit(200);
}

/** Count of tickets awaiting organization triage (for the list-page banner). */
export async function countUnverifiedOrgTickets(): Promise<number> {
  const caller = await requireSessionUser();
  if (
    !(await can(
      caller,
      "organizations.update",
      { type: "global" },
      productionContext,
    ))
  ) {
    return 0;
  }
  const [{ value }] = await db
    .select({ value: count() })
    .from(tickets)
    .where(
      and(eq(tickets.orgMatchStatus, "unverified"), isNull(tickets.deletedAt)),
    );
  return value;
}

/** Link a triaged ticket to a confirmed organization (status → 'staff') and
 *  re-sync any Monthly-Plan deduction now the org is known. The ticket NUMBER
 *  is left immutable — the FK is the source of truth for billing/reporting. */
export async function linkTicketOrganization(
  ticketId: string,
  organizationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await requireOrgTriage();

  const [org] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) return { ok: false, error: "Organization not found." };

  const [ticket] = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      customerCompany: tickets.customerCompany,
    })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!ticket) return { ok: false, error: "Ticket not found." };

  await transactional(async (tx) => {
    await tx
      .update(tickets)
      .set({
        organizationId,
        orgMatchStatus: "staff",
        updatedAt: new Date(),
      })
      .where(eq(tickets.id, ticketId));
    // Now the ticket has a confirmed org, apply any Monthly-Plan deduction.
    await syncMonthlyPlanDeduction(tx, ticketId);
  });

  await audit({
    actorId: caller.id,
    action: "ticket.link_organization",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    after: {
      organizationId,
      organizationName: org.name,
      claimedCompany: ticket.customerCompany,
    },
  });

  revalidatePath("/admin/org-triage");
  revalidatePath("/admin/organizations");
  revalidatePath(`/admin/tickets/${ticketId}`);
  return { ok: true };
}
