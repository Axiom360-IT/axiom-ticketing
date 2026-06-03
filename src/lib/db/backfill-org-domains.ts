import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./client";
import { organizationDomains, organizations } from "./schema/organizations";
import { tickets } from "./schema/tickets";

/**
 * One-shot, idempotent backfill: link historical tickets that have NO
 * organization to the org whose registered email domain matches the ticket's
 * customer email. Sets `org_match_status = 'domain'` (so previously-unverified
 * rows drop out of the triage queue). Re-runs are no-ops once a ticket is
 * linked. Run via `pnpm db:backfill-org-domains` AFTER registering domains on
 * your organizations.
 *
 * LINK-ONLY: it deliberately does NOT touch Monthly-Plan balances — retro-
 * actively draining a running balance for past work would be surprising and
 * wrong for closed periods. It reports how many linked tickets are billed as
 * `monthly_plan` so you can decide whether to reconcile those by hand.
 */
async function main(): Promise<void> {
  // Domains of ACTIVE orgs only — never link to a deactivated org.
  const domainRows = await db
    .select({
      domain: organizationDomains.domain,
      organizationId: organizationDomains.organizationId,
    })
    .from(organizationDomains)
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, organizationDomains.organizationId),
        eq(organizations.isActive, true),
      ),
    );

  if (domainRows.length === 0) {
    console.log(
      "No organization domains registered yet — add domains on your orgs first, then re-run.",
    );
    return;
  }

  let totalLinked = 0;
  let monthlyPlanLinked = 0;

  for (const { domain, organizationId } of domainRows) {
    const linked = await db
      .update(tickets)
      .set({
        organizationId,
        orgMatchStatus: "domain",
        updatedAt: new Date(),
      })
      .where(
        and(
          isNull(tickets.organizationId),
          isNull(tickets.deletedAt),
          // Compare the ticket's email domain to this registered domain.
          sql`lower(split_part(${tickets.customerEmail}, '@', 2)) = ${domain}`,
        ),
      )
      .returning({ id: tickets.id, billable: tickets.billable });

    if (linked.length > 0) {
      const mp = linked.filter((t) => t.billable === "monthly_plan").length;
      monthlyPlanLinked += mp;
      totalLinked += linked.length;
      console.log(
        `  ${domain}: linked ${linked.length} ticket(s)${mp > 0 ? ` (${mp} billed monthly_plan)` : ""}`,
      );
    }
  }

  console.log(`\nBackfill complete. ${totalLinked} ticket(s) linked by domain.`);
  if (monthlyPlanLinked > 0) {
    console.log(
      `Note: ${monthlyPlanLinked} of them are billed as Monthly Plan but were NOT deducted (link-only). ` +
        `Re-toggle their billable category if you want the deduction applied.`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
