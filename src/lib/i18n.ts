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
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = pickLocale(requested);
  return {
    locale,
    messages: (await import(`@/messages/${locale}.json`)).default,
  };
});
