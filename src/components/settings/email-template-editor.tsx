"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useReauthGate } from "@/components/shared/use-reauth-gate";
import { updateEmailTemplateField } from "@/app/actions/email-templates";
import {
  humanizeTemplateKey,
  type EmailTemplateGroup,
} from "@/lib/email/template-catalog";
import type { EmailTemplateFieldView } from "@/lib/email/template-fields";

type TemplateView = {
  key: string;
  group: EmailTemplateGroup;
  fields: EmailTemplateFieldView[];
  editedCount: number;
};

const GROUP_ORDER: EmailTemplateGroup[] = [
  "customer",
  "staff",
  "procurement",
  "accountant",
  "shared",
];

/**
 * Per-field email copy editor. Native <details> accordions (the same pattern
 * the permissions matrix uses — the browser owns the open/closed state, so
 * there's no React state to go stale), one textarea per editable message key.
 * Saving is gated behind the same password re-confirmation as any app-wide
 * setting change.
 */
export function EmailTemplateEditor({
  templates,
}: {
  templates: TemplateView[];
}) {
  const t = useTranslations("emailTemplates");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { runWithReauth, gate } = useReauthGate();

  // Only the field currently being edited holds local state — everything else
  // renders from the server-provided value.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyField, setBusyField] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function fieldId(templateKey: string, fieldKey: string) {
    return `${templateKey}.${fieldKey}`;
  }

  async function save(
    templateKey: string,
    field: EmailTemplateFieldView,
    value: string | null,
  ) {
    const id = fieldId(templateKey, field.key);
    setBusyField(id);
    setErrors((e) => ({ ...e, [id]: "" }));
    const res = await runWithReauth(
      () => updateEmailTemplateField(templateKey, field.key, value),
      "settings",
    );
    setBusyField(null);
    if (!res.ok) {
      setErrors((e) => ({ ...e, [id]: res.error }));
      return;
    }
    setDrafts((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
    router.refresh();
  }

  // Searching matches the template's name AND the copy itself — the point is
  // "which email says this?", which you can't answer from names alone. The
  // live on-screen value (unsaved draft if there is one) is what's searched,
  // so a phrase you just typed is findable before you save it.
  const q = query.trim().toLowerCase();
  function matchesQuery(tpl: TemplateView): boolean {
    if (!q) return true;
    if (humanizeTemplateKey(tpl.key).toLowerCase().includes(q)) return true;
    if (tpl.key.toLowerCase().includes(q)) return true;
    return tpl.fields.some((f) => {
      const live = drafts[fieldId(tpl.key, f.key)] ?? f.effectiveValue;
      return (
        f.key.toLowerCase().includes(q) || live.toLowerCase().includes(q)
      );
    });
  }
  const matched = templates.filter(matchesQuery);

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <label htmlFor="email-template-search" className="sr-only">
          {t("searchLabel")}
        </label>
        <Input
          id="email-template-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
        />
        {q ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("searchResults", { count: matched.length })}
          </p>
        ) : null}
      </div>

      {GROUP_ORDER.map((group) => {
        const inGroup = matched.filter((tpl) => tpl.group === group);
        if (inGroup.length === 0) return null;
        return (
          <section key={group} className="space-y-2">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              {t(`group.${group}`)}
            </h2>
            <div className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {inGroup.map((tpl) => (
                <details
                  key={tpl.key}
                  className="group/details"
                  {...(q ? { open: true } : {})}
                >
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <ChevronRight
                      className="size-4 shrink-0 text-zinc-400 transition-transform group-open/details:rotate-90"
                      aria-hidden="true"
                    />
                    <span className="font-medium">
                      {humanizeTemplateKey(tpl.key)}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {t("fieldCount", { count: tpl.fields.length })}
                    </span>
                    {tpl.editedCount > 0 ? (
                      <span className="rounded bg-amber-100 px-1.5 py-px text-[10px] font-medium uppercase text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                        {t("editedBadge")}
                      </span>
                    ) : null}
                  </summary>

                  <div className="space-y-5 border-t border-zinc-100 px-4 py-4 dark:border-zinc-800">
                    {tpl.fields.map((field) => {
                      const id = fieldId(tpl.key, field.key);
                      const draft = drafts[id];
                      const value = draft ?? field.effectiveValue;
                      const dirty =
                        draft !== undefined && draft !== field.effectiveValue;
                      const busy = busyField === id;
                      return (
                        <div key={field.key} className="space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <label
                              htmlFor={id}
                              className="font-mono text-xs font-medium"
                            >
                              {field.key}
                            </label>
                            {field.overrideValue !== null ? (
                              <span className="text-[10px] uppercase text-amber-600 dark:text-amber-400">
                                {t("editedBadge")}
                              </span>
                            ) : null}
                          </div>
                          <Textarea
                            id={id}
                            rows={value.length > 120 ? 4 : 2}
                            value={value}
                            disabled={busy}
                            onChange={(e) =>
                              setDrafts((d) => ({ ...d, [id]: e.target.value }))
                            }
                          />
                          {field.placeholders.length > 0 ? (
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                              {t("placeholderHint", {
                                tokens: field.placeholders
                                  .map((p) => `{${p}}`)
                                  .join(", "),
                              })}
                            </p>
                          ) : null}
                          {errors[id] ? (
                            <p
                              role="alert"
                              className="text-xs text-red-600 dark:text-red-400"
                            >
                              {errors[id]}
                            </p>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              disabled={!dirty || busy}
                              onClick={() => void save(tpl.key, field, value)}
                            >
                              {busy ? tCommon("saving") : tCommon("save")}
                            </Button>
                            {field.overrideValue !== null ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => void save(tpl.key, field, null)}
                              >
                                {t("resetField")}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </details>
              ))}
            </div>
          </section>
        );
      })}
      {q && matched.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          {t("searchEmpty")}
        </p>
      ) : null}

      {gate}
    </div>
  );
}
