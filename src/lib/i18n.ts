import { getRequestConfig } from "next-intl/server";

// Supported locales. MVP ships English only; adding a locale is a new
// `messages/<locale>.json` plus an entry here (per ARCHITECTURE §18).
export const SUPPORTED_LOCALES = ["en"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "en";

function isSupportedLocale(value: string | null | undefined): value is AppLocale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

/**
 * Resolves a locale from a list of candidate strings. The first supported
 * one wins. Used by the request resolver and by email senders that pass the
 * recipient's `users.language`. Exported for testability.
 */
export function pickLocale(
  ...candidates: ReadonlyArray<string | null | undefined>
): AppLocale {
  for (const c of candidates) {
    if (isSupportedLocale(c)) return c;
  }
  return DEFAULT_LOCALE;
}

// next-intl invokes this once per request. It receives `requestLocale` from
// any `[locale]` URL segment (we don't use one — admin is English-only for
// MVP) plus an optional explicit locale passed by `getTranslations`.
/** True if `tz` is a usable IANA zone (Intl throws on unknown zones). */
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// The zone the app falls back to when the setting is missing/invalid or the
// DB is unreachable (build-time). Matches the seeded `business_hours.timezone`.
const FALLBACK_TIME_ZONE = "America/Toronto";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = pickLocale(requested);

  // Resolve the display time zone from settings so EVERY date/time the app
  // renders — via the next-intl formatter, on the server AND in client
  // components (the provider inherits this) — uses the configured zone (e.g.
  // America/Toronto) instead of the server's UTC default. The dynamic import
  // keeps the DB client out of any client bundle that imports this module's
  // helpers (pickLocale, etc.).
  let timeZone = FALLBACK_TIME_ZONE;
  try {
    const { getSetting } = await import("./settings");
    const configured = await getSetting<string>("business_hours.timezone");
    if (configured && isValidTimeZone(configured)) timeZone = configured;
  } catch {
    // No DB (build-time) or lookup failed — keep the fallback.
  }

  return {
    locale,
    timeZone,
    messages: (await import(`@/messages/${locale}.json`)).default,
  };
});
