// Pure (no server-only deps) so it's usable from unit tests — mirrors
// lib/email/email-domain.ts's split for the same reason.

// Free/personal email providers never get offered "create new org" during a
// customer bulk import — auto-suggesting one would lump unrelated people
// under a fake "Gmail Inc." organization. Rows on these domains always fall
// to "assign to an existing org" or get excluded from the commit.
//
// The list itself lives in lib/email/free-mail.ts — it was duplicated here and
// in lib/tickets/participants.ts and the two had drifted apart.
export { isFreeMailDomain } from "@/lib/email/free-mail";

/**
 * A simple, honest starting point for a new organization's name — NOT a real
 * company-name guess (that's unreliable from a bare domain: "kingsmillfoods.com"
 * isn't recoverable as "Kingsmill Foods Company" without a lookup we don't
 * have). Strips the TLD, splits on separators, title-cases. The admin edits
 * this before anything is created — see suggestOrgCode() in
 * app/actions/organizations.ts for the paired abbreviation suggestion.
 */
export function guessOrgNameFromDomain(domain: string): string {
  const withoutTld = domain.replace(/\.[a-z]{2,}$/i, "");
  const words = withoutTld.split(/[-_.]+/).filter(Boolean);
  if (words.length === 0) return domain;
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
