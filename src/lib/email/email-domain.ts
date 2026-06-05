/** Bare, lower-cased email domain (e.g. "kingsmill.com"), or null if the
 *  address is malformed. Pure (no server-only deps) so it's usable from email
 *  parsing/auth helpers and unit tests. */
export function emailDomain(email: string | null | undefined): string | null {
  const normalized = (email ?? "").trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at < 0) return null;
  const domain = normalized.slice(at + 1).trim();
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  return domain;
}
