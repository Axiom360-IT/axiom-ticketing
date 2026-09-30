// Parsing an RFC 5322 address-list header (`To:`, `Cc:`).
//
// The raw header is the PRIMARY source for harvesting recipients: Resend's
// inbound webhook is metadata-only and its structured `cc` array may be absent
// entirely, while the headers fetched from the Receiving API always carry the
// real `Cc:` line.
//
// Deliberately small and forgiving rather than a full RFC parser — it only has
// to find addresses, and anything it can't make sense of is simply skipped.
// Pure, so it's unit-testable without a mail fixture.

const ADDR = /[^\s<>@,;"]+@[^\s<>@,;"]+\.[^\s<>@,;"]+/g;

/**
 * Every address in a header value, lower-cased and de-duplicated, order
 * preserved. Handles `Name <a@b.com>`, bare `a@b.com`, and a display name
 * containing commas ("Smith, John" <j@x.com>) — the regex matches on the
 * address shape rather than splitting on commas, so quoting can't fool it.
 */
export function parseAddressList(
  value: string | null | undefined,
): string[] {
  if (!value) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of value.matchAll(ADDR)) {
    const email = m[0].trim().toLowerCase().replace(/^[<"']+|[>"',;.]+$/g, "");
    if (!email.includes("@")) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}
