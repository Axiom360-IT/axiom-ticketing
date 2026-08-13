import { parsePhoneNumber, type CountryCode } from "libphonenumber-js/min";

/**
 * Best-effort phone normalization for bulk import. Accepts a raw pasted
 * value in any reasonable format — with or without a country code — plus a
 * fallback country to interpret an ambiguous local-format number against
 * (e.g. "416-555-0123" only resolves to +1 416... given "CA"/"US").
 *
 * Never throws and never blocks the row: an unparseable value just comes
 * back `ok: false` so the caller can drop the phone and keep the person —
 * phone is optional everywhere else in this app, a formatting quirk
 * shouldn't reject the whole row over it.
 *
 * Imports the pure parsing engine directly rather than going through
 * react-phone-number-input (this repo's client-side `<PhoneField>` uses
 * that instead) — that package's root export also constructs its React
 * `<PhoneInput>` component at module load and pulls in prop-types,
 * classnames, country-flag-icons and input-format, none of which belong in
 * a server action's dependency graph.
 */
export function normalizeImportPhone(
  raw: string,
  defaultCountry: string,
): { ok: true; e164: string } | { ok: false } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false };
  try {
    const parsed = parsePhoneNumber(trimmed, defaultCountry as CountryCode);
    if (parsed?.isValid()) {
      return { ok: true, e164: parsed.number };
    }
  } catch {
    // Garbage input (stray characters, etc.) — fall through to ok:false.
  }
  return { ok: false };
}
