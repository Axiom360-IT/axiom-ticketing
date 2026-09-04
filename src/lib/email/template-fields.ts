import "server-only";
import enMessages from "@/messages/en.json";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { emailTemplateOverrides } from "@/lib/db/schema/email-template-overrides";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import {
  EMAIL_TEMPLATE_CATALOG,
  type EmailTemplateGroup,
  isEditableField,
} from "./template-catalog";
import { placeholdersIn } from "./template-interpolate";

// The editable FIELDS of an email template are derived from the message
// catalog itself rather than a hand-maintained list — every plain string under
// `emails.<templateKey>` is editable, so adding a key to a template's
// namespace makes it editable with no second list to update. Rich-text keys
// are filtered out via the catalog (see isEditableField).

export type EmailTemplateField = {
  key: string;
  /** The compiled-in copy — what sends when no override row exists. */
  defaultValue: string;
  /** `{name}` tokens the default text uses; an override may drop them but
   *  may not introduce new ones (nothing would substitute them). */
  placeholders: string[];
};

const EMAILS = (enMessages as unknown as Record<string, unknown>).emails as
  | Record<string, Record<string, unknown>>
  | undefined;

export function listTemplateFields(templateKey: string): EmailTemplateField[] {
  const namespace = EMAILS?.[templateKey];
  if (!namespace || typeof namespace !== "object") return [];
  return Object.entries(namespace)
    .filter(
      ([key, value]) =>
        typeof value === "string" && isEditableField(templateKey, key),
    )
    .map(([key, value]) => ({
      key,
      defaultValue: value as string,
      placeholders: placeholdersIn(value as string),
    }));
}

export function getTemplateFieldDefault(
  templateKey: string,
  fieldKey: string,
): string | null {
  const value = EMAILS?.[templateKey]?.[fieldKey];
  return typeof value === "string" ? value : null;
}

/** A field as shown in the admin editor: its default, the admin's override
 *  (if any), and what will actually send today. */
export type EmailTemplateFieldView = EmailTemplateField & {
  overrideValue: string | null;
  effectiveValue: string;
};

/** Merge the compiled-in fields of one template with the admin's overrides. */
export function buildTemplateFieldViews(
  templateKey: string,
  overrides: Map<string, string>,
): EmailTemplateFieldView[] {
  return listTemplateFields(templateKey).map((f) => {
    const overrideValue = overrides.get(f.key) ?? null;
    return {
      ...f,
      overrideValue,
      effectiveValue: overrideValue ?? f.defaultValue,
    };
  });
}

export type EmailTemplateView = {
  key: string;
  group: EmailTemplateGroup;
  fields: EmailTemplateFieldView[];
  editedCount: number;
};

/**
 * Every editable template with its current (default-or-overridden) copy, for
 * the Settings → Email templates tab. One query for all overrides, merged
 * in-process against the compiled-in message catalog — there is nothing
 * per-template to fetch, so this stays a single round-trip regardless of how
 * many templates exist.
 */
export async function loadEmailTemplateViews(): Promise<EmailTemplateView[]> {
  const rows = await db
    .select({
      templateKey: emailTemplateOverrides.templateKey,
      fieldKey: emailTemplateOverrides.fieldKey,
      value: emailTemplateOverrides.value,
    })
    .from(emailTemplateOverrides)
    .where(eq(emailTemplateOverrides.locale, DEFAULT_LOCALE));

  const byTemplate = new Map<string, Map<string, string>>();
  for (const r of rows) {
    const existing = byTemplate.get(r.templateKey) ?? new Map<string, string>();
    existing.set(r.fieldKey, r.value);
    byTemplate.set(r.templateKey, existing);
  }

  return EMAIL_TEMPLATE_CATALOG.map((entry) => {
    const overrides = byTemplate.get(entry.key) ?? new Map<string, string>();
    const fields = buildTemplateFieldViews(entry.key, overrides);
    return {
      key: entry.key,
      group: entry.group,
      fields,
      editedCount: fields.filter((f) => f.overrideValue !== null).length,
    };
  }).filter((tpl) => tpl.fields.length > 0);
}
