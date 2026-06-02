import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema/organizations";
import { getSetting } from "@/lib/settings";

// ── Organization resolution for ticket creation (Meeting-2, CR-02/06/07) ─
//
// Every ticket-creation path resolves the submitter's organization to:
//   - organizationId: the registered org's id (FK), or null when unmatched
//   - prefix:         the ticket-number prefix (org abbreviation, or a
//                     2-letter fallback derived from a typed name, else "AX")
//   - timeZone:       the business timezone, so the number's date is local.
// ─────────────────────────────────────────────────────────────────────

export type ResolvedOrg = {
  organizationId: string | null;
  prefix: string;
  timeZone: string;
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

/**
 * Resolve a typed organization name (guest/public path). Matches a registered
 * organization case-insensitively; otherwise links nothing and derives a
 * prefix from the typed name so the number still reflects the company.
 */
export async function resolveTicketOrgByName(
  orgName: string | null | undefined,
): Promise<ResolvedOrg> {
  const timeZone = await businessTimeZone();
  const name = (orgName ?? "").trim();
  if (!name) return { organizationId: null, prefix: "AX", timeZone };

  const [match] = await db
    .select({ id: organizations.id, abbreviation: organizations.abbreviation })
    .from(organizations)
    .where(sql`lower(${organizations.name}) = lower(${name})`)
    .limit(1);
  if (match) {
    return { organizationId: match.id, prefix: match.abbreviation, timeZone };
  }
  return { organizationId: null, prefix: deriveAbbrev(name), timeZone };
}

/**
 * Resolve an organization by id (authenticated-customer path — the org comes
 * from the user's account). Falls back to "AX" when the org is unknown.
 */
export async function resolveTicketOrgById(
  organizationId: string | null | undefined,
): Promise<ResolvedOrg> {
  const timeZone = await businessTimeZone();
  if (!organizationId) return { organizationId: null, prefix: "AX", timeZone };

  const [match] = await db
    .select({ id: organizations.id, abbreviation: organizations.abbreviation })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (match) {
    return { organizationId: match.id, prefix: match.abbreviation, timeZone };
  }
  return { organizationId: null, prefix: "AX", timeZone };
}
