import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { emailTemplateOverrides } from "@/lib/db/schema/email-template-overrides";
import { isEditableField } from "./template-catalog";

// ── Admin-reworded email copy ─────────────────────────────────────────
//
// Templates render their text from next-intl keys. This layer lets an admin
// override any of those PLAIN-TEXT keys from Settings → Email templates without
// touching code or the message catalog: `withEmailOverrides` wraps a
// template's translator so an overridden key returns the admin's wording and
// everything else falls through to the compiled-in default untouched.
//
// Deliberately NOT a full ICU implementation — the app's email messages use
// next-intl's basic `{name}` interpolation only, and rich-text keys (t.rich)
// are excluded from editing entirely, so simple token substitution is exactly
// equivalent to what next-intl would produce for the editable set.
// ──────────────────────────────────────────────────────────────────────

import { interpolate } from "./template-interpolate";

export { interpolate, placeholdersIn } from "./template-interpolate";

/**
 * Overrides for one template+locale, keyed by field. Fails SOFT: if the table
 * is missing or the query errors, we return no overrides so email sending
 * keeps working on the compiled-in copy rather than throwing mid-send.
 */
export async function loadEmailOverrides(
  templateKey: string,
  locale: string,
): Promise<Map<string, string>> {
  try {
    const rows = await db
      .select({
        fieldKey: emailTemplateOverrides.fieldKey,
        value: emailTemplateOverrides.value,
      })
      .from(emailTemplateOverrides)
      .where(
        and(
          eq(emailTemplateOverrides.templateKey, templateKey),
          eq(emailTemplateOverrides.locale, locale),
        ),
      );
    const map = new Map<string, string>();
    for (const r of rows) {
      // Defense in depth: never let a stale row for a rich-text key take
      // effect, even if one somehow got written before the key was excluded.
      if (isEditableField(templateKey, r.fieldKey)) map.set(r.fieldKey, r.value);
    }
    return map;
  } catch (err) {
    console.error(
      `[email/template-text] override lookup failed for ${templateKey}:`,
      err,
    );
    return new Map();
  }
}

type PlainTranslator = (key: string, values?: Record<string, unknown>) => string;

/**
 * Wrap a template's next-intl translator so admin overrides win.
 *
 * Call sites pass the translator they already built, so the exact next-intl
 * type (and its compile-time message-key checking) is preserved verbatim:
 *
 *   const t = await withEmailOverrides(
 *     "ticketCreated",
 *     locale,
 *     await getTranslations({ locale, namespace: "emails.ticketCreated" }),
 *   );
 *
 * `t.rich` / `.markup` / `.raw` / `.has` pass straight through to next-intl —
 * only the plain `t(key, values)` path consults overrides.
 */
export async function withEmailOverrides<T>(
  templateKey: string,
  locale: string,
  base: T,
): Promise<T> {
  const overrides = await loadEmailOverrides(templateKey, locale);
  if (overrides.size === 0) return base;

  // A Proxy (rather than copying properties onto a new function) so every
  // helper next-intl hangs off the translator — `.rich`, `.markup`, `.raw`,
  // `.has` — keeps working with its original `this`, regardless of how
  // they're defined. Only the plain call path is intercepted.
  return new Proxy(base as unknown as PlainTranslator, {
    apply(target, thisArg, args: unknown[]) {
      const [key, values] = args as [
        string,
        Record<string, unknown> | undefined,
      ];
      const override = overrides.get(key);
      if (override !== undefined) return interpolate(override, values);
      return Reflect.apply(target, thisArg, args);
    },
  }) as unknown as T;
}
