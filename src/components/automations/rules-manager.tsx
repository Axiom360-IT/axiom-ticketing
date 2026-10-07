"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  Copy,
  Hourglass,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useReauthGate } from "@/components/shared/use-reauth-gate";
import {
  createRule,
  deleteRule,
  duplicateRule,
  type PreviewResult,
  previewRuleNow,
  type RuleActivity,
  ruleActivity,
  setRuleEnabled,
  updateRule,
} from "@/app/actions/automation-rules";
import type { ClientCatalog } from "@/lib/rules/catalog";
import { describeRule } from "@/lib/rules/describe";
import type { RuleCard, RuleRefs } from "@/lib/rules/panel";
import {
  RULE_TEMPLATES,
  type RuleTemplate,
  TEMPLATE_CATEGORY_LABELS,
} from "@/lib/rules/templates";
import type { ConditionGroup, DedupePolicy, RuleAction } from "@/lib/rules/types";
import { cn } from "@/lib/utils";
import { emptyDraft, RuleBuilder, type RuleDraft, triggerOf } from "./rule-builder";

// ── The rules section ─────────────────────────────────────────────────
//
// Templates are the front door. A blank builder is the escape hatch, not the
// starting point — most rules should be "click one, change two numbers,
// save", and the empty state leads with the library rather than with a form.
//
// Every rule arrives SWITCHED OFF and every template does only `flag` (record
// it, tell nobody). Both defaults exist so that trying something cannot cost
// anybody an unwanted text message at 2am, which is what makes the feature
// safe to explore rather than frightening.

type Props = {
  rules: RuleCard[];
  refs: RuleRefs;
  catalog: ClientCatalog;
  backlog: { pending: number; oldestMinutes: number | null };
  engineEnabled: boolean;
  timezone: string;
};

const KIND_ICON = {
  event: Zap,
  state: Hourglass,
  schedule: CalendarClock,
} as const;

export function RulesManager({
  rules,
  refs,
  catalog,
  backlog,
  engineEnabled,
  timezone,
}: Props) {
  const t = useTranslations("automations.rules");
  const router = useRouter();
  const { runWithReauth, gate } = useReauthGate();

  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [activityFor, setActivityFor] = useState<{
    rule: RuleCard;
    data: RuleActivity | null;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RuleCard | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [previewing, startPreview] = useTransition();

  function openNew() {
    setPreview(null);
    setError(null);
    setDraft(emptyDraft());
  }

  function openTemplate(template: RuleTemplate) {
    setPreview(null);
    setError(null);
    setShowTemplates(false);
    setDraft(draftFromTemplate(template));
  }

  function openEdit(rule: RuleCard) {
    setPreview(null);
    setError(null);
    setDraft(draftFromRule(rule));
  }

  function runPreview() {
    if (!draft) return;
    startPreview(async () => {
      setPreview(
        await previewRuleNow(
          {
            trigger: triggerOf(draft),
            conditions: draft.conditions,
            applyToExisting: draft.applyToExisting,
          },
          draft.createdAt ?? undefined,
        ),
      );
    });
  }

  function save() {
    if (!draft) return;
    setError(null);
    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      trigger: triggerOf(draft),
      conditions: draft.conditions,
      actions: draft.actions,
      dedupe:
        draft.dedupePolicy === "throttle"
          ? { policy: draft.dedupePolicy, throttleMinutes: draft.throttleMinutes }
          : { policy: draft.dedupePolicy },
      stopOnMatch: draft.stopOnMatch,
      allowChaining: draft.allowChaining,
      applyToExisting: draft.applyToExisting,
      order: draft.order,
    };

    startTransition(async () => {
      const id = draft.id;
      const res = await runWithReauth(
        () => (id ? updateRule(id, payload) : createRule(payload)),
        "settings",
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDraft(null);
      setPreview(null);
      router.refresh();
    });
  }

  function toggle(rule: RuleCard, enabled: boolean) {
    startTransition(async () => {
      const res = await setRuleEnabled(rule.id, enabled);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  function copy(rule: RuleCard) {
    startTransition(async () => {
      const res = await duplicateRule(rule.id);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  function remove(rule: RuleCard) {
    startTransition(async () => {
      const res = await runWithReauth(() => deleteRule(rule.id), "settings");
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setConfirmDelete(null);
      router.refresh();
    });
  }

  function openActivity(rule: RuleCard) {
    setActivityFor({ rule, data: null });
    startTransition(async () => {
      const res = await ruleActivity(rule.id);
      setActivityFor({ rule, data: res.ok ? res.activity : null });
    });
  }

  const live = rules.filter((r) => r.enabled && !r.brokenReason).length;
  const needsAttention = rules.filter((r) => r.brokenReason).length;

  return (
    <section className="space-y-3">
      {/* ── Heading ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
            <Wand2 className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold">{t("heading")}</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("subheading")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setShowTemplates(true)}>
            <Sparkles className="size-3.5" aria-hidden="true" />
            {t("browseTemplates")}
          </Button>
          <Button size="sm" onClick={openNew}>
            <Plus className="size-3.5" aria-hidden="true" />
            {t("newRule")}
          </Button>
        </div>
      </div>

      {/* ── Health strip ───────────────────────────────────────────── */}
      {rules.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            <span className="font-semibold tabular-nums">{live}</span> {t("statLive")}
          </span>
          {needsAttention > 0 ? (
            <span className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              <span className="font-semibold tabular-nums">{needsAttention}</span>{" "}
              {t("statBroken")}
            </span>
          ) : null}
          {backlog.pending > 0 ? (
            <span
              className={cn(
                "rounded-lg border px-2 py-1",
                (backlog.oldestMinutes ?? 0) > 15
                  ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                  : "border-zinc-200 bg-white text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
              )}
            >
              {t("statBacklog", { count: backlog.pending })}
            </span>
          ) : null}
          {!engineEnabled ? (
            <span className="rounded-lg border border-zinc-300 bg-zinc-100 px-2 py-1 font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {t("engineOff")}
            </span>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {/* ── The rules ──────────────────────────────────────────────── */}
      {rules.length === 0 ? (
        <EmptyState onBrowse={() => setShowTemplates(true)} onNew={openNew} />
      ) : (
        <ul className="space-y-2">
          {rules.map((rule) => {
            const Icon =
              KIND_ICON[rule.triggerKind as keyof typeof KIND_ICON] ?? Zap;
            const broken = Boolean(rule.brokenReason);
            return (
              <li
                key={rule.id}
                className={cn(
                  "rounded-lg border border-l-4 bg-white p-3 dark:bg-zinc-900",
                  broken
                    ? "border-zinc-200 border-l-amber-500 dark:border-zinc-800"
                    : rule.enabled
                      ? "border-zinc-200 border-l-emerald-500 dark:border-zinc-800"
                      : "border-zinc-200 border-l-zinc-300 dark:border-zinc-800 dark:border-l-zinc-600",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      <Icon className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                      <span className={cn(!rule.enabled && "text-zinc-500")}>
                        {rule.name}
                      </span>
                      {!rule.enabled ? (
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">
                          {t("paused")}
                        </span>
                      ) : null}
                    </p>

                    {/* The sentence — never jsonb, never an id. */}
                    <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                      {rule.sentence ?? t("unreadable")}
                    </p>

                    {broken ? (
                      <p className="mt-1.5 flex items-start gap-1 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-900 dark:bg-amber-950/50 dark:text-amber-300">
                        <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                        {rule.brokenReason}
                      </p>
                    ) : null}

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      {rule.firedLast24h > 0 ? (
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                          {t("firedCount", { count: rule.firedLast24h })}
                        </span>
                      ) : (
                        <span className="text-zinc-400">{t("quiet")}</span>
                      )}
                      {rule.errorsLast24h > 0 ? (
                        <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700 dark:bg-red-950/50 dark:text-red-300">
                          {t("errorCount", { count: rule.errorsLast24h })}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("viewActivity")}
                      onClick={() => openActivity(rule)}
                    >
                      <Activity className="size-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("edit")}
                      onClick={() => openEdit(rule)}
                    >
                      <Pencil className="size-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("duplicate")}
                      disabled={isPending}
                      onClick={() => copy(rule)}
                    >
                      <Copy className="size-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("delete")}
                      disabled={isPending}
                      onClick={() => setConfirmDelete(rule)}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </Button>
                    <label className="ml-1 inline-flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={rule.enabled}
                        disabled={isPending}
                        aria-label={t("enabledLabel", { name: rule.name })}
                        onChange={(e) => toggle(rule, e.target.checked)}
                      />
                      <span className="relative h-5 w-9 rounded-full bg-zinc-200 transition-colors peer-checked:bg-emerald-500 dark:bg-zinc-700 after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4" />
                    </label>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* ── Builder ────────────────────────────────────────────────── */}
      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDraft(null);
            setPreview(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.id ? t("editTitle") : t("newTitle")}</DialogTitle>
            <DialogDescription>
              {draft?.id ? t("editBlurb") : t("newBlurb", { timezone })}
            </DialogDescription>
          </DialogHeader>

          {draft ? (
            <RuleBuilder
              draft={draft}
              onChange={setDraft}
              catalog={catalog}
              refs={refs}
              onPreview={runPreview}
              preview={preview}
              previewing={previewing}
              disabled={isPending}
            />
          ) : null}

          {error ? (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDraft(null);
                setPreview(null);
              }}
            >
              {t("cancel")}
            </Button>
            <Button onClick={save} disabled={isPending || !draft?.name.trim()}>
              {draft?.id ? t("saveChanges") : t("createPaused")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Templates ──────────────────────────────────────────────── */}
      <Dialog open={showTemplates} onOpenChange={setShowTemplates}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("templatesTitle")}</DialogTitle>
            <DialogDescription>{t("templatesBlurb")}</DialogDescription>
          </DialogHeader>
          <TemplateGallery onPick={openTemplate} />
        </DialogContent>
      </Dialog>

      {/* ── Activity ───────────────────────────────────────────────── */}
      <Dialog
        open={activityFor !== null}
        onOpenChange={(open) => !open && setActivityFor(null)}
      >
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{activityFor?.rule.name}</DialogTitle>
            <DialogDescription>{t("activityBlurb")}</DialogDescription>
          </DialogHeader>
          <ActivityView data={activityFor?.data ?? null} />
        </DialogContent>
      </Dialog>

      {/* ── Delete ─────────────────────────────────────────────────── */}
      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteBlurb", { name: confirmDelete?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => confirmDelete && remove(confirmDelete)}
            >
              {t("deleteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {gate}
    </section>
  );
}

// ── Pieces ────────────────────────────────────────────────────────────

function EmptyState({
  onBrowse,
  onNew,
}: {
  onBrowse: () => void;
  onNew: () => void;
}) {
  const t = useTranslations("automations.rules");
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
      <Sparkles className="mx-auto size-5 text-zinc-400" aria-hidden="true" />
      <p className="mt-2 text-sm font-medium">{t("emptyTitle")}</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500 dark:text-zinc-400">
        {t("emptyBlurb")}
      </p>
      <div className="mt-3 flex justify-center gap-2">
        <Button size="sm" onClick={onBrowse}>
          <Sparkles className="size-3.5" aria-hidden="true" />
          {t("emptyBrowse")}
        </Button>
        <Button variant="outline" size="sm" onClick={onNew}>
          {t("emptyBlank")}
        </Button>
      </div>
    </div>
  );
}

function TemplateGallery({ onPick }: { onPick: (t: RuleTemplate) => void }) {
  const t = useTranslations("automations.rules");
  const categories = [
    ...new Set(RULE_TEMPLATES.map((x) => x.category)),
  ] as RuleTemplate["category"][];

  return (
    <div className="space-y-4">
      <p className="rounded bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
        {t("templatesSafeNote")}
      </p>
      {categories.map((category) => (
        <div key={category} className="space-y-1.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            {TEMPLATE_CATEGORY_LABELS[category]}
          </h3>
          <ul className="grid gap-1.5">
            {RULE_TEMPLATES.filter((x) => x.category === category).map((template) => (
              <li key={template.id}>
                <button
                  type="button"
                  onClick={() => onPick(template)}
                  className="w-full rounded-lg border border-zinc-200 p-2.5 text-left transition-colors hover:border-blue-400 hover:bg-blue-50/50 dark:border-zinc-700 dark:hover:border-blue-600 dark:hover:bg-blue-950/30"
                >
                  <p className="text-sm font-medium">{template.name}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                    {template.blurb}
                  </p>
                  <p className="mt-1 text-[11px] italic text-zinc-500 dark:text-zinc-400">
                    {template.tweak}
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-400">
                    {describeRule(template)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ActivityView({ data }: { data: RuleActivity | null }) {
  const t = useTranslations("automations.rules");
  if (!data) {
    return <p className="text-xs text-zinc-500">{t("activityLoading")}</p>;
  }
  const { actions, misses } = data;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1.5 text-xs font-semibold">{t("activityDid")}</h3>
        {actions.length === 0 ? (
          <p className="text-xs text-zinc-500">{t("activityNothingDone")}</p>
        ) : (
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded border border-zinc-200 text-xs dark:divide-zinc-800 dark:border-zinc-800">
            {actions.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-medium",
                    a.outcome === "ok"
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : a.outcome === "error"
                        ? "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
                  )}
                >
                  {a.outcome}
                </span>
                <span className="font-medium">{a.ticketNumber ?? "—"}</span>
                <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300">
                  {a.error ?? a.detail ?? a.actionType}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The "why didn't my rule fire?" answer. The single feature that
          prevents most of the support load a rule engine creates. */}
      <div>
        <h3 className="mb-1.5 text-xs font-semibold">{t("activityDidNot")}</h3>
        {misses.length === 0 ? (
          <p className="text-xs text-zinc-500">{t("activityNoMisses")}</p>
        ) : (
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded border border-zinc-200 text-xs dark:divide-zinc-800 dark:border-zinc-800">
            {misses.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
                <span className="font-medium">{m.ticketNumber ?? "—"}</span>
                <span className="min-w-0 flex-1 text-zinc-600 dark:text-zinc-300">
                  {m.reason}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Draft conversion ──────────────────────────────────────────────────

function draftFromTemplate(template: RuleTemplate): RuleDraft {
  const base = emptyDraft();
  const trigger = template.trigger;
  return {
    ...base,
    name: template.name,
    description: template.blurb,
    triggerKind: trigger.kind,
    event: trigger.kind === "event" ? trigger.event : base.event,
    state: trigger.kind === "state" ? trigger.state : base.state,
    stateMinutes: trigger.kind === "state" ? trigger.minutes : base.stateMinutes,
    hour: trigger.kind === "schedule" ? trigger.hour : base.hour,
    minute: trigger.kind === "schedule" ? trigger.minute : base.minute,
    weekdays: trigger.kind === "schedule" ? [...trigger.weekdays] : base.weekdays,
    conditions: template.conditions,
    actions: template.actions,
    dedupePolicy: template.dedupe.policy,
    throttleMinutes: template.dedupe.throttleMinutes ?? base.throttleMinutes,
  };
}

function draftFromRule(rule: RuleCard): RuleDraft {
  const base = emptyDraft();
  const trigger = rule.trigger as Record<string, unknown> | null;
  const kind = (trigger?.kind as RuleDraft["triggerKind"]) ?? "event";
  const dedupe = (rule.dedupe ?? {}) as {
    policy?: DedupePolicy;
    throttleMinutes?: number;
  };

  return {
    ...base,
    id: rule.id,
    name: rule.name,
    description: rule.description ?? "",
    triggerKind: kind,
    event: (trigger?.event as RuleDraft["event"]) ?? base.event,
    state: (trigger?.state as RuleDraft["state"]) ?? base.state,
    stateMinutes:
      typeof trigger?.minutes === "number" ? trigger.minutes : base.stateMinutes,
    hour: typeof trigger?.hour === "number" ? trigger.hour : base.hour,
    minute: typeof trigger?.minute === "number" ? trigger.minute : base.minute,
    weekdays: Array.isArray(trigger?.weekdays)
      ? (trigger.weekdays as string[])
      : base.weekdays,
    conditions: (rule.conditions as ConditionGroup) ?? base.conditions,
    actions: (rule.actions as RuleAction[]) ?? base.actions,
    dedupePolicy: dedupe.policy ?? base.dedupePolicy,
    throttleMinutes: dedupe.throttleMinutes ?? base.throttleMinutes,
    stopOnMatch: rule.stopOnMatch,
    allowChaining: rule.allowChaining,
    applyToExisting: rule.applyToExisting,
    order: rule.order,
    createdAt: rule.createdAt,
  };
}
