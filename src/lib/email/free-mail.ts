// Public free-mail providers, in one place.
//
// Two copies of this list had drifted apart: lib/tickets/participants.ts used
// it to decide whether a shared email domain implies organizational
// membership (it never does on a free-mail domain), and
// lib/customer-import/domain-guess.ts used it to decide whether to offer
// "create a new organization" during a bulk import. Each knew domains the
// other didn't, so the same address could be treated as company mail by one
// and personal mail by the other.
//
// Pure (no `server-only`) so both callers and unit tests can import it.

const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.ca",
  "yahoo.co.uk",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "zoho.com",
  "mail.com",
  "yandex.com",
]);

export function isFreeMailDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  return FREE_MAIL_DOMAINS.has(domain.trim().toLowerCase());
}

/** The domain part of an address, lower-cased, or null if it isn't one. */
export function domainOfEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

export function isFreeMailAddress(email: string | null | undefined): boolean {
  return isFreeMailDomain(domainOfEmail(email));
}
