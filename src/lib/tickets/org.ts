import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  organizationDomains,
  organizations,
} from "@/lib/db/schema/organizations";
import { getSetting } from "@/lib/settings";

// ── Organization resolution for ticket creation (Meeting-2, CR-02/06/07) ─
//
// Every ticket-creation path resolves the submitter's organization to:
//   - organizationId: the registered org's id (FK), or null when unconfirmed
//   - prefix:         the ticket-number prefix (org abbreviation, or a
//                     2-letter fallback derived from a typed name, else "AX")
//   - timeZone:       the business timezone, so the number's date is local.
//   - matchStatus:    how the org was determined (drives the triage queue and
//                     keeps unverifiable claims out of billing).
//
// A typed company name is a weak, unverifiable signal, so it NEVER auto-links
// an org by itself. The trustworthy signal is the submitter's email DOMAIN: an
// org registers its domains, and a guest whose email matches one is linked
// (and billed) automatically. Anything else that types a company is recorded
// as `unverified` for a coordinator to reconcile.
// ─────────────────────────────────────────────────────────────────────

export type OrgMatchStatus =
  | "account" // from an authenticated customer's account org (trusted)
  | "domain" // matched by the submitter's email domain
  | "staff" // manually linked/confirmed by a coordinator
  | "unverified" // a company was claimed but not confirmed (organizationId NULL)
  | "none"; // no organization information at all

export type ResolvedOrg = {
  organizationId: string | null;
  prefix: string;
  timeZone: string;
  matchStatus: OrgMatchStatus;
};

async function businessTimeZone(): Promise<string> {
  const tz = await getSetting<string>("business_hours.timezone");
  return tz && tz.trim() ? tz : "UTC";
}

/** Derive a 2-char ticket-number prefix from a free-text organization name. */
function deriveAbbrev(name: string): string {
  const cleaned = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.slice(0, 2) || "AX";
}

/** Bare, lower-cased email domain (e.g. "kingsmill.com"), or null if the
 *  address is malformed. */
export function emailDomain(email: string | null | undefined): string | null {
  const normalized = (email ?? "").trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at < 0) return null;
  const domain = normalized.slice(at + 1).trim();
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  return domain;
}

/**
 * Resolve the organization for a GUEST/public submission from the submitter's
 * email + the company name they typed:
 *   1. Email-domain match against a registered org → linked, `matchStatus:
 *      "domain"` (the only auto-link path).
 *   2. A company was typed but no domain matched → `unverified` (organizationId
 *      stays NULL; the raw name is stored by the caller for triage).
 *   3. Nothing → `none`.
 */
export async function resolveTicketOrgForGuest(
  email: string | null | undefined,
  typedCompany: string | null | undefined,
): Promise<ResolvedOrg> {
  const timeZone = await businessTimeZone();
  const company = (typedCompany ?? "").trim();

  const domain = emailDomain(email);
  if (domain) {
    const [match] = await db
      .select({
        id: organizations.id,
        abbreviation: organizations.abbreviation,
      })
      .from(organizationDomains)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationDomains.organizationId),
      )
      .where(
        and(
          eq(organizationDomains.domain, domain),
          eq(organizations.isActive, true),
        ),
      )
      .limit(1);
    if (match) {
      return {
        organizationId: match.id,
        prefix: match.abbreviation,
        timeZone,
        matchStatus: "domain",
      };
    }
  }

  if (company) {
    // Claimed but unverifiable — keep the prefix readable, link nothing.
    return {
      organizationId: null,
      prefix: deriveAbbrev(company),
      timeZone,
      matchStatus: "unverified",
    };
  }

  return { organizationId: null, prefix: "AX", timeZone, matchStatus: "none" };
}

/**
 * Resolve an organization by id (authenticated-customer path — the org comes
 * from the user's account, or a staff member's explicit pick). Returns
 * `matchStatus: "account"` on a hit; callers acting on a staff pick override
 * the status to `"staff"`. Falls back to "AX"/"none" when the org is unknown.
 */
export async function resolveTicketOrgById(
  organizationId: string | null | undefined,
): Promise<ResolvedOrg> {
  const timeZone = await businessTimeZone();
  if (!organizationId) {
    return { organizationId: null, prefix: "AX", timeZone, matchStatus: "none" };
  }

  const [match] = await db
    .select({ id: organizations.id, abbreviation: organizations.abbreviation })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (match) {
    return {
      organizationId: match.id,
      prefix: match.abbreviation,
      timeZone,
      matchStatus: "account",
    };
  }
  return { organizationId: null, prefix: "AX", timeZone, matchStatus: "none" };
}
