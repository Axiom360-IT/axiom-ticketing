import { parsePhoneNumber, type Country } from "react-phone-number-input";

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
 */
export function normalizeImportPhone(
  raw: string,
  defaultCountry: string,
): { ok: true; e164: string } | { ok: false } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false };
  try {
    const parsed = parsePhoneNumber(trimmed, defaultCountry as Country);
    if (parsed?.isValid()) {
      return { ok: true, e164: parsed.number };
    }
  } catch {
    // Garbage input (stray characters, etc.) — fall through to ok:false.
  }
  return { ok: false };
}
