import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { EmailTemplateEditor } from "@/components/settings/email-template-editor";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { emailTemplateOverrides } from "@/lib/db/schema/email-template-overrides";
import { EMAIL_TEMPLATE_CATALOG } from "@/lib/email/template-catalog";
import { buildTemplateFieldViews } from "@/lib/email/template-fields";
import { DEFAULT_LOCALE } from "@/lib/i18n";

export async function generateMetadata() {
  const t = await getTranslations("emailTemplates");
  return { title: t("title") };
}

export default async function EmailTemplatesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (
    !(await can(user, "settings.update", { type: "global" }, productionContext))
  ) {
    redirect("/admin");
  }

  const t = await getTranslations("emailTemplates");

  // One query for every override, then merge in-process — the defaults come
  // from the compiled-in message catalog, so there's nothing per-template to
  // fetch.
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

  const templates = EMAIL_TEMPLATE_CATALOG.map((entry) => {
    const overrides = byTemplate.get(entry.key) ?? new Map<string, string>();
    const fields = buildTemplateFieldViews(entry.key, overrides);
    return {
      key: entry.key,
      group: entry.group,
      fields,
      editedCount: fields.filter((f) => f.overrideValue !== null).length,
    };
  }).filter((tpl) => tpl.fields.length > 0);

  return (
    <div className="space-y-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold sm:text-2xl">{t("title")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t("subtitle")}
        </p>
      </div>

      <EmailTemplateEditor templates={templates} />
    </div>
  );
}
