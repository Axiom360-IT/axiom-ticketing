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
import { workLogs } from "@/lib/db/schema/work-logs";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { enforceUserRateLimit } from "@/lib/ratelimit";
import { notifyBalanceChanged } from "@/lib/billing/events";
import {
  emptyBucket,
  normalizeCategory,
  type OrganizationUsage,
  type UsageBucket,
} from "@/lib/billing/usage";
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
  // NOTE: there is intentionally NO `monthlyHoursBalance` here — the balance
  // ("hours remaining") is read-only (req 8.1) and only ever changes through
  // logged work, the monthly reset, and the admin add-hours action.
  monthlyHoursIncluded: z.number().min(0).max(100000).nullable().optional(),
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

// ── Organization code (abbreviation) generation + validation ───────

/** Gate for the code helpers: the caller must be able to create or update
 *  organizations (the only surfaces that pick a code). */
async function requireOrgManage() {
  const caller = await requireSessionUser();
  const ok =
    (await can(caller, "organizations.create", { type: "global" }, productionContext)) ||
    (await can(caller, "organizations.update", { type: "global" }, productionContext));
  if (!ok) throw new ForbiddenError();
  return caller;
}

/** Derive a 2–5 char upper-case code seed from an org name: word initials for
 *  multi-word names ("Kingsmill Foods Ltd" → "KFL"), else the first letters of
 *  a single word ("Kingsmill" → "KING"). Padded to ≥2 chars. */
function deriveCodeBase(name: string): string {
  const cleaned = (name ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .trim();
  if (!cleaned) return "";
  const words = cleaned.split(/\s+/).filter(Boolean);
  let base =
    words.length >= 2
      ? words.map((w) => w[0]).join("")
      : (words[0] ?? "").slice(0, 4);
  base = base.replace(/[^A-Z0-9]/g, "").slice(0, 5);
  if (base.length < 2) {
    base = ((words[0] ?? "") + "XX").replace(/[^A-Z0-9]/g, "").slice(0, 2);
  }
  return base;
}

/** First code (base, then base+1, base+2, …, ≤5 chars) not already taken or
 *  excluded, checking against the in-memory set of existing abbreviations. */
function firstAvailableCode(
  base: string,
  existing: Set<string>,
  exclude: Set<string>,
): string {
  const tryCode = (c: string): string | null =>
    c.length >= 2 &&
    ABBREVIATION_RE.test(c) &&
    !existing.has(c) &&
    !exclude.has(c)
      ? c
      : null;

  const direct = tryCode(base);
  if (direct) return direct;

  for (let i = 1; i <= 9999; i++) {
    const suffix = String(i);
    const head = base.slice(0, Math.max(1, 5 - suffix.length));
    const candidate = tryCode((head + suffix).slice(0, 5));
    if (candidate) return candidate;
  }
  return base; // give up gracefully (server still rejects a dup on submit)
}

export type SuggestCodeResult =
  | { ok: true; code: string }
  | { ok: false; error: string };

/** Suggest a unique organization code derived from the name. `exclude` lets the
 *  "Generate" button request a code different from the current one. */
export async function suggestOrgCode(
  name: string,
  exclude: string[] = [],
): Promise<SuggestCodeResult> {
  await requireOrgManage();
  const base = deriveCodeBase(name);
  if (!base) {
    return { ok: false, error: "Enter an organization name first." };
  }
  const rows = await db
    .select({ abbreviation: organizations.abbreviation })
    .from(organizations);
  const existing = new Set(rows.map((r) => r.abbreviation));
  const excludeSet = new Set(
    exclude.map((e) => normalizeAbbreviation(e)).filter(Boolean),
  );
  return { ok: true, code: firstAvailableCode(base, existing, excludeSet) };
}

/** Real-time availability/format check for a manually-entered code. */
export async function checkOrgCode(
  code: string,
  excludeId?: string,
): Promise<{ valid: boolean; available: boolean; normalized: string }> {
  await requireOrgManage();
  const normalized = normalizeAbbreviation(code);
  if (!ABBREVIATION_RE.test(normalized)) {
    return { valid: false, available: false, normalized };
  }
  const taken = await abbreviationTaken(normalized, excludeId);
  return { valid: true, available: !taken, normalized };
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
  // A monthly plan MUST have positive included hours — otherwise its balance is
  // NULL and it is silently skipped by the reset cron and the deduction logic.
  if (
    data.isMonthlyPlan &&
    (data.monthlyHoursIncluded == null || data.monthlyHoursIncluded <= 0)
  ) {
    return {
      ok: false,
      error: "Enter the monthly included hours for a monthly-plan organization.",
    };
  }

  const minutesIncluded = data.isMonthlyPlan
    ? hoursToMinutes(data.monthlyHoursIncluded)
    : null;
  // Balance ("hours remaining") always STARTS at the included allotment — it is
  // never entered by hand (req 8.1). It then moves only via logged work, the
  // monthly reset, and the admin add-hours action.
  const minutesBalance = data.isMonthlyPlan ? minutesIncluded : null;

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
      // Mark as reset for the current month so the daily reset cron leaves the
      // fresh balance alone until the next 1st (req 8.2).
      monthlyPlanResetAt: data.isMonthlyPlan ? new Date() : null,
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
      set.monthlyPlanResetAt = null;
      set.negativeBalanceAlertedAt = null;
    }
  } else {
    if (data.monthlyHoursIncluded !== undefined) {
      set.monthlyMinutesIncluded = hoursToMinutes(data.monthlyHoursIncluded);
    }
    // The balance ("hours remaining") is read-only (req 8.1) and is never set
    // from this form. The ONE exception is initialization: when an org first
    // turns its monthly plan ON, the balance starts at the included allotment
    // (and is marked reset for the current month).
    if (!org.isMonthlyPlan) {
      set.monthlyMinutesBalance =
        set.monthlyMinutesIncluded ?? org.monthlyMinutesIncluded ?? null;
      set.monthlyPlanResetAt = new Date();
      set.negativeBalanceAlertedAt = null;
    }
    // A monthly plan must keep positive included hours (see createOrganization).
    const effectiveIncluded =
      set.monthlyMinutesIncluded !== undefined
        ? set.monthlyMinutesIncluded
        : org.monthlyMinutesIncluded;
    if (effectiveIncluded == null || effectiveIncluded <= 0) {
      return {
        ok: false,
        error: "Enter the monthly included hours for a monthly-plan organization.",
      };
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

// ── addOrganizationHours (req 8.3) ─────────────────────────────────
//
// The ONLY way an admin can manually move the balance, and it's additive only
// (a top-up for a given month when the included hours run short). The balance
// is otherwise read-only (req 8.1). Accepts a positive decimal-hours amount,
// adds it to the running balance, and re-checks the over-plan alert so a
// top-up that brings the balance back to >= 0 clears the alert state.

const addHoursSchema = z.object({
  hours: z.number().positive().max(100000),
});

export async function addOrganizationHours(
  organizationId: string,
  hours: number,
): Promise<{ ok: true; newBalanceMinutes: number } | { ok: false; error: string }> {
  const parsed = addHoursSchema.safeParse({ hours });
  if (!parsed.success) {
    return { ok: false, error: "Enter a positive number of hours." };
  }
  const caller = await requireSessionUser();
  await enforceUserRateLimit("authManageOrganization", caller.id);
  if (
    !(await can(caller, "organizations.update", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }

  const [org] = await db
    .select({
      id: organizations.id,
      isMonthlyPlan: organizations.isMonthlyPlan,
      balance: organizations.monthlyMinutesBalance,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) return { ok: false, error: "Organization not found." };
  if (!org.isMonthlyPlan) {
    return { ok: false, error: "This organization is not on a monthly plan." };
  }

  const addMinutes = hoursToMinutes(parsed.data.hours) ?? 0;
  const newBalance = (org.balance ?? 0) + addMinutes;

  await db
    .update(organizations)
    .set({
      monthlyMinutesBalance: newBalance,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, organizationId));

  await audit({
    actorId: caller.id,
    action: "organization.add_hours",
    targetType: "organization",
    targetId: organizationId,
    before: { monthlyMinutesBalance: org.balance },
    after: { monthlyMinutesBalance: newBalance, addedMinutes: addMinutes },
  });

  // Re-evaluate the over-plan alert (a top-up may have cleared the deficit).
  await notifyBalanceChanged([organizationId]);

  revalidatePath("/admin/organizations");
  revalidatePath(`/admin/organizations/${organizationId}`);
  return { ok: true, newBalanceMinutes: newBalance };
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

// ── Per-organization work breakdown by category (reqs 8.4/8.5) ─────
//
// Every work category is tracked, not just Monthly Support. We aggregate
// work-log minutes per calendar month (UTC, to match the monthly reset) ×
// category for the org, then pivot for the UI. Shared types/helpers live in
// `@/lib/billing/usage` (this "use server" file can only export async fns).

export async function getOrganizationUsage(
  organizationId: string,
): Promise<OrganizationUsage> {
  const caller = await requireSessionUser();
  if (
    !(await can(caller, "organizations.view", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }

  const rows = await db
    .select({
      ym: sql<string>`to_char(date_trunc('month', ${workLogs.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM')`,
      billable: tickets.billable,
      minutes: sql<number>`coalesce(sum(${workLogs.minutes}), 0)::int`,
    })
    .from(workLogs)
    .innerJoin(tickets, eq(workLogs.ticketId, tickets.id))
    .where(eq(tickets.organizationId, organizationId))
    .groupBy(sql`date_trunc('month', ${workLogs.createdAt} AT TIME ZONE 'UTC')`, tickets.billable)
    .orderBy(sql`date_trunc('month', ${workLogs.createdAt} AT TIME ZONE 'UTC') desc`);

  const byMonth = new Map<string, UsageBucket>();
  const allTime = emptyBucket();
  for (const r of rows) {
    const cat = normalizeCategory(r.billable);
    const mins = Number(r.minutes) || 0;
    let bucket = byMonth.get(r.ym);
    if (!bucket) {
      bucket = emptyBucket();
      byMonth.set(r.ym, bucket);
    }
    bucket.byCategory[cat] += mins;
    bucket.total += mins;
    allTime.byCategory[cat] += mins;
    allTime.total += mins;
  }

  const currentYm = new Date().toISOString().slice(0, 7);
  const months = [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 6)
    .map(([ym, bucket]) => ({ ym, ...bucket }));

  const cur = byMonth.get(currentYm) ?? emptyBucket();
  return {
    currentMonth: { ym: currentYm, ...cur },
    allTime,
    months,
  };
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

  const affectedOrgId = await transactional(async (tx) => {
    await tx
      .update(tickets)
      .set({
        organizationId,
        orgMatchStatus: "staff",
        updatedAt: new Date(),
      })
      .where(eq(tickets.id, ticketId));
    // Now the ticket has a confirmed org, apply any Monthly-Plan deduction.
    return syncMonthlyPlanDeduction(tx, ticketId);
  });
  await notifyBalanceChanged([affectedOrgId]);

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

/** Mark a triaged ticket as having no organization (a genuine individual /
 *  one-off submitter), clearing it from the triage queue. Leaves
 *  organizationId NULL and sets the status to 'none'. */
export async function dismissTicketOrganization(
  ticketId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await requireOrgTriage();

  const [ticket] = await db
    .select({ id: tickets.id, ticketNumber: tickets.ticketNumber })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!ticket) return { ok: false, error: "Ticket not found." };

  await db
    .update(tickets)
    .set({ orgMatchStatus: "none", updatedAt: new Date() })
    .where(eq(tickets.id, ticketId));

  await audit({
    actorId: caller.id,
    action: "ticket.dismiss_organization",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
  });

  revalidatePath("/admin/org-triage");
  revalidatePath("/admin/organizations");
  revalidatePath(`/admin/tickets/${ticketId}`);
  return { ok: true };
}
