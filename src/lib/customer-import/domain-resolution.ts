import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  organizationDomains,
  organizations,
} from "@/lib/db/schema/organizations";
import { emailDomain } from "@/lib/email/email-domain";
import { isFreeMailDomain } from "./domain-guess";

export type DomainResolution = {
  domain: string;
  organizationId: string | null;
  organizationName: string | null;
  isFreeMail: boolean;
};

/**
 * Batch-resolve every distinct email domain across a bulk-import file
 * against registered organizations in ONE query — mirrors the per-row
 * lookup in resolveTicketOrgForGuest (lib/tickets/org.ts), sized for
 * hundreds of rows at once instead of one query per row.
 */
export async function resolveDomainsForImport(
  emails: (string | null | undefined)[],
): Promise<Map<string, DomainResolution>> {
  const distinctDomains = new Set<string>();
  for (const email of emails) {
    const domain = emailDomain(email);
    if (domain) distinctDomains.add(domain);
  }

  const result = new Map<string, DomainResolution>();
  if (distinctDomains.size === 0) return result;

  const matches = await db
    .select({
      domain: organizationDomains.domain,
      organizationId: organizations.id,
      organizationName: organizations.name,
    })
    .from(organizationDomains)
    .innerJoin(
      organizations,
      eq(organizations.id, organizationDomains.organizationId),
    )
    .where(
      and(
        inArray(organizationDomains.domain, [...distinctDomains]),
        eq(organizations.isActive, true),
      ),
    );
  const matchByDomain = new Map(matches.map((m) => [m.domain, m]));

  for (const domain of distinctDomains) {
    const match = matchByDomain.get(domain);
    result.set(domain, {
      domain,
      organizationId: match?.organizationId ?? null,
      organizationName: match?.organizationName ?? null,
      isFreeMail: isFreeMailDomain(domain),
    });
  }
  return result;
}
