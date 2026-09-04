"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { isReauthFresh, reauthRequiredResult } from "@/lib/auth/reauth";
import { requireSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { emailTemplateOverrides } from "@/lib/db/schema/email-template-overrides";
import {
  isEditableField,
  isEmailTemplateKey,
} from "@/lib/email/template-catalog";
import { getTemplateFieldDefault } from "@/lib/email/template-fields";
import { placeholdersIn } from "@/lib/email/template-interpolate";
import { ForbiddenError } from "@/lib/errors";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { enforceUserRateLimit } from "@/lib/ratelimit";

// Admin-editable email copy (see lib/email/template-text.ts). Every action
// here is gated on `settings.update` and, like updateSetting, requires a fresh
// password confirmation — reworded copy goes out to every future recipient,
// so it has the same blast radius as an app-wide setting.

export type EmailTemplateResult =
  | { ok: true }
  | { ok: false; error: string; reauthRequired?: true };

async function requireTemplateEditor() {
  const caller = await requireSessionUser();
  if (
    !(await can(caller, "settings.update", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }
  return caller;
}

/**
 * Save (or clear, with `value: null`) one field's wording. Clearing deletes
 * the row so the compiled-in default takes over again — "reset to default" is
 * the absence of a row, never a copy of the default text.
 */
export async function updateEmailTemplateField(
  templateKey: string,
  fieldKey: string,
  value: string | null,
): Promise<EmailTemplateResult> {
  const caller = await requireTemplateEditor();
  await enforceUserRateLimit("authUpdateSetting", caller.id);
  if (!(await isReauthFresh(caller.id))) {
    return reauthRequiredResult();
  }

  if (!isEmailTemplateKey(templateKey)) {
    return { ok: false, error: `Unknown email template: ${templateKey}` };
  }
  if (!isEditableField(templateKey, fieldKey)) {
    return { ok: false, error: "This field can't be edited." };
  }
  const defaultValue = getTemplateFieldDefault(templateKey, fieldKey);
  if (defaultValue === null) {
    return { ok: false, error: `Unknown field: ${fieldKey}` };
  }

  const [existing] = await db
    .select({ value: emailTemplateOverrides.value })
    .from(emailTemplateOverrides)
    .where(
      and(
        eq(emailTemplateOverrides.templateKey, templateKey),
        eq(emailTemplateOverrides.locale, DEFAULT_LOCALE),
        eq(emailTemplateOverrides.fieldKey, fieldKey),
      ),
    )
    .limit(1);

  if (value === null) {
    await db
      .delete(emailTemplateOverrides)
      .where(
        and(
          eq(emailTemplateOverrides.templateKey, templateKey),
          eq(emailTemplateOverrides.locale, DEFAULT_LOCALE),
          eq(emailTemplateOverrides.fieldKey, fieldKey),
        ),
      );
  } else {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return { ok: false, error: "Text can't be empty. Reset it instead." };
    }
    if (trimmed.length > 5000) {
      return { ok: false, error: "Text is too long (max 5000 characters)." };
    }
    // Placeholder safety: an override may DROP a variable the default used
    // (the admin's wording may not need it), but may not introduce one that
    // nothing substitutes — that would render as literal "{foo}" in a real
    // email, which is never what someone means to send.
    const allowed = new Set(placeholdersIn(defaultValue));
    const unknown = placeholdersIn(trimmed).filter((p) => !allowed.has(p));
    if (unknown.length > 0) {
      return {
        ok: false,
        error: `Unknown placeholder${unknown.length > 1 ? "s" : ""}: ${unknown
          .map((p) => `{${p}}`)
          .join(", ")}. Available here: ${
          allowed.size > 0
            ? [...allowed].map((p) => `{${p}}`).join(", ")
            : "none"
        }.`,
      };
    }

    await db
      .insert(emailTemplateOverrides)
      .values({
        templateKey,
        locale: DEFAULT_LOCALE,
        fieldKey,
        value: trimmed,
        updatedById: caller.id,
      })
      .onConflictDoUpdate({
        target: [
          emailTemplateOverrides.templateKey,
          emailTemplateOverrides.locale,
          emailTemplateOverrides.fieldKey,
        ],
        set: {
          value: trimmed,
          updatedById: caller.id,
          updatedAt: new Date(),
        },
      });
  }

  await audit({
    actorId: caller.id,
    action: value === null ? "email_template.reset" : "email_template.update",
    targetType: "email_template",
    targetId: `${templateKey}.${fieldKey}`,
    before: { value: existing?.value ?? null },
    after: { value },
  });

  revalidatePath("/admin/settings");
  return { ok: true };
}
