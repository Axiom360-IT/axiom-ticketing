import "server-only";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { organizationDomains, organizations } from "@/lib/db/schema/organizations";

// Shared organization validation helpers — extracted out of
// app/actions/organizations.ts (a "use server" file, which can only export
// async functions — these constants/sync functions can't live there and be
// exported) so they can be reused by the MCP connector's organization tools
// without duplicating this logic.

// Abbreviation: 2–5 upper-case alphanumerics. Used as the ticket-number prefix
// (e.g. "KI" → KI-20260522-001), so it is normalised before validation.
export const ABBREVIATION_RE = /^[A-Z0-9]{2,5}$/;

export function normalizeAbbreviation(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 5);
}

/** Convert an optional decimal-hours input to whole minutes, or null. */
export function hoursToMinutes(hours: number | null | undefined): number | null {
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
export function normalizeDomains(input: string[] | undefined): string[] {
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
export async function conflictingDomains(
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

export async function abbreviationTaken(abbrev: string, excludeId?: string) {
  const [row] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(
      excludeId
        ? and(eq(organizations.abbreviation, abbrev), ne(organizations.id, excludeId))
        : eq(organizations.abbreviation, abbrev),
    )
    .limit(1);
  return Boolean(row);
}

export async function nameTaken(name: string, excludeId?: string) {
  const [row] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(
      excludeId
        ? and(sql`lower(${organizations.name}) = lower(${name})`, ne(organizations.id, excludeId))
        : sql`lower(${organizations.name}) = lower(${name})`,
    )
    .limit(1);
  return Boolean(row);
}
