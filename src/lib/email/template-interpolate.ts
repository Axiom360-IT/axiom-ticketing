// Pure placeholder helpers for admin-overridden email copy. Split out of
// template-text.ts (which is server-only, since it hits the DB) so the logic
// is unit-testable without a database — same split as sla-compute.ts vs sla.ts.

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Substitute `{name}` tokens, matching next-intl's basic interpolation for the
 * plain-text messages this app's emails use. An unknown token is left verbatim
 * rather than throwing — a stray placeholder should never break a real send.
 */
export function interpolate(
  text: string,
  values?: Record<string, unknown>,
): string {
  if (!values) return text;
  return text.replace(PLACEHOLDER, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name)
      ? String(values[name])
      : match,
  );
}

/** The distinct `{name}` tokens a message references, first-seen order. */
export function placeholdersIn(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER)) found.add(m[1]);
  return [...found];
}
