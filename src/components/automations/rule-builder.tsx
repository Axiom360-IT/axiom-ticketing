"use client";

import { useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronDown,
  Hourglass,
  Loader2,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LabeledSelect } from "./labeled-select";
import { Textarea } from "@/components/ui/textarea";
import type { PreviewResult } from "@/app/actions/automation-rules";
import type { ClientCatalog, ClientFieldDef } from "@/lib/rules/catalog";
import { describeRuleParts } from "@/lib/rules/describe";
import { policiesFor } from "@/lib/rules/dedupe";
import {
  ACTION_LABELS,
  AUDIENCE_LABELS,
  CHANNEL_LABELS,
  DEDUPE_LABELS,
  EVENT_LABELS,
  FIELD_LABELS,
  OPERATOR_LABELS,
  STATE_LABELS,
  valueLabel,
} from "@/lib/rules/labels";
import type { RuleRefs } from "@/lib/rules/panel";
import { PLACEHOLDERS, PLACEHOLDER_LABELS, unknownPlaceholders } from "@/lib/rules/render";
import type {
  Condition,
  ConditionGroup,
  ConditionNode,
  ConditionOperator,
  DedupePolicy,
  EventTriggerId,
  NotifyAudience,
  NotifyChannel,
  RuleAction,
  StateTriggerId,
} from "@/lib/rules/types";
import { cn } from "@/lib/utils";

// ── The rule builder ──────────────────────────────────────────────────
//
// Shaped as a SENTENCE, not a form: When … / Only if … / Then …, with each
// bold part a dropdown. The generated sentence sits at the top and updates as
// you type, so the thing you are reading is the thing that will run — there
// is no second representation to drift from it.
//
// Three things make this usable rather than merely powerful:
//   • durations are a number and a unit, never "4320"
//   • the preview says how many tickets match BEFORE the save button does
//     anything
//   • actions that cannot run yet are shown, disabled, with the reason — so
//     the shape of what is coming is visible instead of mysterious

export type RuleDraft = {
  id: string | null;
  name: string;
  description: string;
  triggerKind: "event" | "state" | "schedule";
  event: EventTriggerId;
  state: StateTriggerId;
  stateMinutes: number;
  hour: number;
  minute: number;
  weekdays: string[];
  conditions: ConditionGroup;
  actions: RuleAction[];
  dedupePolicy: DedupePolicy;
  throttleMinutes: number;
  stopOnMatch: boolean;
  allowChaining: boolean;
  applyToExisting: boolean;
  order: number;
  createdAt: string | null;
};

export function emptyDraft(): RuleDraft {
  return {
    id: null,
    name: "",
    description: "",
    triggerKind: "event",
    event: "ticket.created",
    state: "unassigned_for",
    stateMinutes: 30,
    hour: 8,
    minute: 0,
    weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    conditions: { combinator: "all", conditions: [] },
    actions: [{ type: "flag", reason: "{ticketNumber} matched this rule." }],
    dedupePolicy: "once_per_occurrence",
    throttleMinutes: 1440,
    stopOnMatch: false,
    allowChaining: false,
    applyToExisting: false,
    order: 100,
    createdAt: null,
  };
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** The catalog's labels are written to read mid-sentence ("a ticket is
 *  raised"). On their own in a dropdown they want a capital. */
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

type Props = {
  draft: RuleDraft;
  onChange: (next: RuleDraft) => void;
  catalog: ClientCatalog;
  refs: RuleRefs;
  onPreview: () => void;
  preview: PreviewResult | null;
  previewing: boolean;
  disabled?: boolean;
};

export function RuleBuilder({
  draft,
  onChange,
  catalog,
  refs,
  onPreview,
  preview,
  previewing,
  disabled,
}: Props) {
  const t = useTranslations("automations.rules");
  const set = <K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) =>
    onChange({ ...draft, [key]: value });

  const sentence = useMemo(() => {
    const names = {
      users: Object.fromEntries(refs.users.map((u) => [u.id, u.name])),
      roles: Object.fromEntries(refs.roles.map((r) => [r.name, r.name])),
      organizations: Object.fromEntries(
        refs.organizations.map((o) => [o.id, o.name]),
      ),
    };
    return describeRuleParts(
      { trigger: triggerOf(draft), conditions: draft.conditions, actions: draft.actions },
      names,
    );
  }, [draft, refs]);

  const policies = policiesFor(draft.triggerKind);

  return (
    <div className="space-y-5">
      {/* ── The sentence ─────────────────────────────────────────────
          Sticky, so it stays in view while you scroll the form: the point of
          it is to watch the rule read back as you build it. */}
      <div className="sticky top-0 z-10 rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm dark:border-blue-900 dark:bg-blue-950/80">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
          {t("sentenceHeading")}
        </p>
        <p className="text-base leading-relaxed text-zinc-900 dark:text-zinc-50">
          <span className="font-medium">{sentence.when}</span>
          {sentence.conditions ? (
            <>
              {", "}
              {t("andWord")} <span className="font-medium">{sentence.conditions}</span>
            </>
          ) : null}
          {", "}
          <span className="font-medium">{sentence.then}</span>.
        </p>
      </div>

      {/* ── Name ───────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <Label htmlFor="rule-name">{t("nameLabel")}</Label>
        <Input
          id="rule-name"
          value={draft.name}
          disabled={disabled}
          maxLength={120}
          placeholder={t("namePlaceholder")}
          onChange={(e) => set("name", e.target.value)}
        />
      </div>

      {/* Two columns on a wide screen: what SETS IT OFF on the left, what it DOES
          on the right. One long column made a wide modal pointless. */}
      <div className="grid items-start gap-5 lg:grid-cols-2">
      <div className="space-y-5">
      {/* ── WHEN ───────────────────────────────────────────────────── */}
      <Section step={1} title={t("whenHeading")} hint={t("whenHint")}>
        <div className="grid gap-1.5 sm:grid-cols-3">
          <KindTab
            active={draft.triggerKind === "event"}
            icon={Zap}
            label={t("kindEvent")}
            hint={t("kindEventHint")}
            disabled={disabled}
            onClick={() => set("triggerKind", "event")}
          />
          <KindTab
            active={draft.triggerKind === "state"}
            icon={Hourglass}
            label={t("kindState")}
            hint={t("kindStateHint")}
            disabled={disabled}
            onClick={() => set("triggerKind", "state")}
          />
          <KindTab
            active={draft.triggerKind === "schedule"}
            icon={CalendarClock}
            label={t("kindSchedule")}
            hint={t("kindScheduleHint")}
            disabled={disabled}
            onClick={() => set("triggerKind", "schedule")}
          />
        </div>

        {draft.triggerKind === "event" ? (
          <LabeledSelect
            value={draft.event}
            disabled={disabled}
            className="h-10 w-full text-sm"
            aria-label={t("whenHeading")}
            options={catalog.eventOrder.map((id) => ({
              value: id,
              label: cap(EVENT_LABELS[id as EventTriggerId]),
              // Grouped, so thirty events read as six short lists.
              group: t(
                `eventGroup.${catalog.events[id]?.category ?? "lifecycle"}`,
              ),
            }))}
            onValueChange={(v) => set("event", v as EventTriggerId)}
          />
        ) : null}

        {draft.triggerKind === "state" ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-zinc-600 dark:text-zinc-300">
              {t("stateLeadIn")}
            </span>
            <LabeledSelect
              value={draft.state}
              disabled={disabled}
              className="h-10 min-w-[16rem] flex-1 text-sm"
              aria-label={t("whenHeading")}
              options={catalog.stateOrder.map((id) => ({
                value: id,
                label: STATE_LABELS[id as StateTriggerId],
              }))}
              onValueChange={(v) => {
                const next = v as StateTriggerId;
                onChange({
                  ...draft,
                  state: next,
                  stateMinutes: catalog.states[next]?.defaultMinutes ?? 30,
                });
              }}
            />
            <DurationInput
              minutes={draft.stateMinutes}
              disabled={disabled}
              onChange={(m) => set("stateMinutes", m)}
            />
          </div>
        ) : null}

        {draft.triggerKind === "schedule" ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={23}
                className="w-20"
                disabled={disabled}
                value={draft.hour}
                onChange={(e) => set("hour", clamp(e.target.value, 0, 23))}
              />
              <span className="text-sm text-zinc-500">:</span>
              <Input
                type="number"
                min={0}
                max={59}
                className="w-20"
                disabled={disabled}
                value={draft.minute}
                onChange={(e) => set("minute", clamp(e.target.value, 0, 59))}
              />
              <span className="text-xs text-zinc-500">{t("localTimeHint")}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {WEEKDAYS.map((d) => {
                const on = draft.weekdays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      set(
                        "weekdays",
                        on
                          ? draft.weekdays.filter((x) => x !== d)
                          : [...draft.weekdays, d],
                      )
                    }
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs",
                      on
                        ? "border-blue-500 bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                        : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800",
                    )}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("scheduleActsPerTicket")}
            </p>
          </div>
        ) : null}
      </Section>

      {/* ── ONLY IF ────────────────────────────────────────────────── */}
      <Section step={2} title={t("ifHeading")} hint={t("ifHint")}>
        <GroupEditor
          group={draft.conditions}
          catalog={catalog}
          refs={refs}
          disabled={disabled}
          depth={0}
          onChange={(g) => set("conditions", g)}
        />
      </Section>

      </div>
      <div className="space-y-5">
      {/* ── THEN ───────────────────────────────────────────────────── */}
      <Section step={3} title={t("thenHeading")} hint={t("thenHint")}>
        <div className="space-y-2">
          {draft.actions.map((action, i) => (
            <ActionRow
              key={i}
              action={action}
              catalog={catalog}
              refs={refs}
              disabled={disabled}
              onChange={(a) =>
                set(
                  "actions",
                  draft.actions.map((x, j) => (j === i ? a : x)),
                )
              }
              onRemove={
                draft.actions.length > 1
                  ? () =>
                      set(
                        "actions",
                        draft.actions.filter((_, j) => j !== i),
                      )
                  : undefined
              }
            />
          ))}
          {draft.actions.length < 10 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() =>
                set("actions", [
                  ...draft.actions,
                  { type: "flag", reason: "{ticketNumber} matched." },
                ])
              }
            >
              <Plus className="size-3.5" aria-hidden="true" />
              {t("addAction")}
            </Button>
          ) : null}
        </div>
      </Section>

      {/* ── How often ──────────────────────────────────────────────── */}
      <Section step={4} title={t("howOftenHeading")} hint={t("howOftenHint")}>
        <div className="flex flex-wrap items-center gap-2">
          <LabeledSelect
            value={draft.dedupePolicy}
            disabled={disabled}
            className="h-10 min-w-[16rem] flex-1 text-sm"
            aria-label={t("howOftenHeading")}
            options={policies.map((p) => ({ value: p, label: cap(DEDUPE_LABELS[p]) }))}
            onValueChange={(v) => set("dedupePolicy", v as DedupePolicy)}
          />
          {draft.dedupePolicy === "throttle" ? (
            <DurationInput
              minutes={draft.throttleMinutes}
              disabled={disabled}
              onChange={(m) => set("throttleMinutes", m)}
            />
          ) : null}
        </div>
        {!policies.includes(draft.dedupePolicy) ? (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t("policyNotAllowed", { policy: DEDUPE_LABELS[draft.dedupePolicy] })}
          </p>
        ) : null}

        <div className="space-y-1.5 pt-1">
          <Check1
            checked={draft.stopOnMatch}
            disabled={disabled}
            label={t("stopOnMatch")}
            hint={t("stopOnMatchHint")}
            onChange={(v) => set("stopOnMatch", v)}
          />
          {draft.triggerKind === "state" ? (
            <Check1
              checked={draft.applyToExisting}
              disabled={disabled}
              label={t("applyToExisting")}
              hint={t("applyToExistingHint")}
              onChange={(v) => set("applyToExisting", v)}
            />
          ) : null}
          <Check1
            checked={draft.allowChaining}
            disabled={disabled}
            label={t("allowChaining")}
            hint={t("allowChainingHint")}
            onChange={(v) => set("allowChaining", v)}
          />
        </div>
      </Section>

      </div>
      </div>

      {/* ── Preview ────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">{t("previewHeading")}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("previewHint")}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || previewing}
            onClick={onPreview}
          >
            {previewing ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : null}
            {t("previewButton")}
          </Button>
        </div>

        {preview && !preview.ok ? (
          <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
            {preview.error}
          </p>
        ) : null}

        {preview?.ok ? (
          <div className="mt-3 space-y-2">
            <p className="text-sm">
              <span className="text-lg font-semibold tabular-nums">
                {preview.preview.matches}
              </span>{" "}
              <span className="text-zinc-600 dark:text-zinc-300">
                {preview.preview.hypothetical
                  ? t("previewCountHypothetical", {
                      considered: preview.preview.considered,
                    })
                  : t("previewCount", { considered: preview.preview.considered })}
              </span>
            </p>

            {preview.preview.excludedAsExisting > 0 ? (
              <p className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-300">
                {t("previewExcluded", {
                  count: preview.preview.excludedAsExisting,
                })}
              </p>
            ) : null}

            {preview.preview.sample.length > 0 ? (
              <ul className="divide-y divide-zinc-100 overflow-hidden rounded border border-zinc-200 text-xs dark:divide-zinc-800 dark:border-zinc-800">
                {preview.preview.sample.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 px-2 py-1.5">
                    <span className="font-medium">{s.ticketNumber}</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300">
                      {s.subject}
                    </span>
                    <span className="shrink-0 text-zinc-400">
                      {valueLabel(s.priority)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            {preview.preview.matches === 0 && preview.preview.topReason ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {t("previewTopReason", { reason: preview.preview.topReason })}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The draft's trigger in the shape the engine and `describe` expect. */
export function triggerOf(draft: RuleDraft) {
  if (draft.triggerKind === "event") {
    return { kind: "event" as const, event: draft.event };
  }
  if (draft.triggerKind === "state") {
    return {
      kind: "state" as const,
      state: draft.state,
      minutes: draft.stateMinutes,
    };
  }
  return {
    kind: "schedule" as const,
    hour: draft.hour,
    minute: draft.minute,
    weekdays: draft.weekdays as ("Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun")[],
  };
}

// ── Pieces ────────────────────────────────────────────────────────────

function Section({
  step,
  title,
  hint,
  children,
}: {
  step: number;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
          {step}
        </span>
        <div>
          <h3 className="text-sm font-semibold leading-6">{title}</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function KindTab({
  active,
  icon: Icon,
  label,
  hint,
  disabled,
  onClick,
}: {
  active: boolean;
  icon: typeof Zap;
  label: string;
  hint: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-lg border p-2 text-left transition-colors disabled:opacity-50",
        active
          ? "border-blue-500 bg-blue-50 dark:bg-blue-950/50"
          : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800",
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium">
        <Icon
          className={cn("size-3.5", active ? "text-blue-600 dark:text-blue-400" : "text-zinc-400")}
          aria-hidden="true"
        />
        {label}
      </span>
      <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
        {hint}
      </span>
    </button>
  );
}

/**
 * A duration as a number and a unit.
 *
 * Operators think in hours and days; the engine stores minutes. Showing
 * "4320" where somebody means "three days" is the single fastest way to make
 * a rule builder feel like a database admin tool.
 */
function DurationInput({
  minutes,
  onChange,
  disabled,
}: {
  minutes: number;
  onChange: (minutes: number) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("automations.rules");
  // Pick the largest unit that divides exactly, so a value set as "3 days"
  // comes back as "3 days" rather than "4320 minutes".
  const unit = minutes % 1440 === 0 && minutes >= 1440 ? 1440 : minutes % 60 === 0 && minutes >= 60 ? 60 : 1;
  const amount = Math.round(minutes / unit);

  return (
    <span className="inline-flex items-center gap-1.5">
      <Input
        type="number"
        min={0}
        className="h-10 w-24 text-sm"
        disabled={disabled}
        value={amount}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) && n >= 0 ? Math.round(n) * unit : 0);
        }}
      />
      <LabeledSelect
        value={String(unit)}
        disabled={disabled}
        className="h-10 w-32 text-sm"
        options={[
          { value: "1", label: t("unitMinutes") },
          { value: "60", label: t("unitHours") },
          { value: "1440", label: t("unitDays") },
        ]}
        onValueChange={(v) => onChange(amount * Number(v))}
      />
    </span>
  );
}

function Check1({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2 text-xs">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-3.5 rounded border-zinc-300 dark:border-zinc-600"
      />
      <label htmlFor={id} className="cursor-pointer">
        <span className="font-medium text-zinc-700 dark:text-zinc-200">{label}</span>
        <span className="block text-zinc-500 dark:text-zinc-400">{hint}</span>
      </label>
    </div>
  );
}

function clamp(raw: string, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(Math.round(n), min), max);
}

// ── Conditions ────────────────────────────────────────────────────────

function isGroupNode(n: ConditionNode): n is ConditionGroup {
  return "combinator" in n;
}

function GroupEditor({
  group,
  catalog,
  refs,
  disabled,
  depth,
  onChange,
  onRemove,
}: {
  group: ConditionGroup;
  catalog: ClientCatalog;
  refs: RuleRefs;
  disabled?: boolean;
  depth: number;
  onChange: (g: ConditionGroup) => void;
  onRemove?: () => void;
}) {
  const t = useTranslations("automations.rules");

  const setNode = (i: number, node: ConditionNode) =>
    onChange({
      ...group,
      conditions: group.conditions.map((c, j) => (j === i ? node : c)),
    });
  const removeNode = (i: number) =>
    onChange({ ...group, conditions: group.conditions.filter((_, j) => j !== i) });

  return (
    <div
      className={cn(
        "space-y-2",
        depth > 0 &&
          "rounded-lg border border-zinc-200 bg-zinc-50/60 p-2 dark:border-zinc-700 dark:bg-zinc-900/40",
      )}
    >
      {group.conditions.length > 1 ? (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-zinc-500">{t("match")}</span>
          <LabeledSelect
            value={group.combinator}
            disabled={disabled}
            className="h-8 w-36 text-sm"
            options={[
              { value: "all", label: t("matchAll") },
              { value: "any", label: t("matchAny") },
            ]}
            onValueChange={(v) => onChange({ ...group, combinator: v as "all" | "any" })}
          />
          {onRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={disabled}
              aria-label={t("removeGroup")}
              onClick={onRemove}
              className="ml-auto"
            >
              <Trash2 className="size-3" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ) : null}

      {group.conditions.length === 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("noConditions")}</p>
      ) : null}

      {group.conditions.map((node, i) =>
        isGroupNode(node) ? (
          <GroupEditor
            key={i}
            group={node}
            catalog={catalog}
            refs={refs}
            disabled={disabled}
            depth={depth + 1}
            onChange={(g) => setNode(i, g)}
            onRemove={() => removeNode(i)}
          />
        ) : (
          <ConditionRow
            key={i}
            condition={node}
            catalog={catalog}
            refs={refs}
            disabled={disabled}
            onChange={(c) => setNode(i, c)}
            onRemove={() => removeNode(i)}
          />
        ),
      )}

      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled}
          onClick={() =>
            onChange({
              ...group,
              conditions: [
                ...group.conditions,
                { field: "priority", operator: "is", value: "critical" },
              ],
            })
          }
        >
          <Plus className="size-3" aria-hidden="true" />
          {t("addCondition")}
        </Button>
        {/* One level of nesting only: deeper buys expressiveness nobody uses
            and costs comprehensibility everybody pays for. */}
        {depth === 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={disabled}
            onClick={() =>
              onChange({
                ...group,
                conditions: [
                  ...group.conditions,
                  {
                    combinator: "any",
                    conditions: [
                      { field: "priority", operator: "is", value: "critical" },
                    ],
                  },
                ],
              })
            }
          >
            <Plus className="size-3" aria-hidden="true" />
            {t("addGroup")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ConditionRow({
  condition,
  catalog,
  refs,
  disabled,
  onChange,
  onRemove,
}: {
  condition: Condition;
  catalog: ClientCatalog;
  refs: RuleRefs;
  disabled?: boolean;
  onChange: (c: Condition) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("automations.rules");
  const def = catalog.fields[condition.field] as ClientFieldDef | undefined;

  const grouped = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const id of catalog.fieldOrder) {
      const d = catalog.fields[id];
      if (!d) continue;
      const list = out.get(d.group) ?? [];
      list.push(id);
      out.set(d.group, list);
    }
    return out;
  }, [catalog]);

  if (!def) {
    // A rule saved before a field was renamed. Say so and let them fix it.
    return (
      <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="flex-1">{t("unknownField", { field: condition.field })}</span>
        <Button type="button" variant="ghost" size="icon-xs" onClick={onRemove}>
          <Trash2 className="size-3" aria-hidden="true" />
        </Button>
      </div>
    );
  }

  const needsValue = !["is_empty", "is_not_empty"].includes(condition.operator);
  const isList = ["is_one_of", "is_not_one_of"].includes(condition.operator);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <LabeledSelect
        value={condition.field}
        disabled={disabled}
        className="h-10 min-w-[14rem] flex-1 text-sm"
        options={[...grouped.entries()].flatMap(([groupName, ids]) =>
          ids.map((id) => ({
            value: id,
            label: cap(FIELD_LABELS[id as keyof typeof FIELD_LABELS] ?? id),
            group: t(`fieldGroup.${groupName}`),
          })),
        )}
        onValueChange={(field) => {
          const next = catalog.fields[field];
          if (!next) return;
          // Reset the operator and value: carrying "is more than" onto a text
          // field would produce a condition that can never be true.
          onChange({
            field,
            operator: (next.operators[0] ?? "is") as ConditionOperator,
            value: next.valueType === "boolean" ? true : undefined,
          });
        }}
      />

      <LabeledSelect
        value={condition.operator}
        disabled={disabled}
        className="h-10 w-44 text-sm"
        options={def.operators.map((op) => ({ value: op, label: OPERATOR_LABELS[op] }))}
        onValueChange={(op) => {
          onChange({
            ...condition,
            operator: op as ConditionOperator,
            value: ["is_one_of", "is_not_one_of"].includes(op)
              ? Array.isArray(condition.value)
                ? condition.value
                : condition.value != null
                  ? [String(condition.value)]
                  : []
              : Array.isArray(condition.value)
                ? (condition.value[0] ?? undefined)
                : condition.value,
          });
        }}
      />

      {needsValue ? (
        <ValueInput
          def={def}
          refs={refs}
          multi={isList}
          value={condition.value}
          disabled={disabled}
          onChange={(value) => onChange({ ...condition, value })}
        />
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={disabled}
        aria-label={t("removeCondition")}
        onClick={onRemove}
      >
        <Trash2 className="size-3" aria-hidden="true" />
      </Button>
    </div>
  );
}

function ValueInput({
  def,
  refs,
  multi,
  value,
  onChange,
  disabled,
}: {
  def: ClientFieldDef;
  refs: RuleRefs;
  multi: boolean;
  value: Condition["value"];
  onChange: (v: Condition["value"]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("automations.rules");
  const options = optionsFor(def, refs);

  if (def.valueType === "boolean") {
    return (
      <LabeledSelect
        value={value === true || value === "true" ? "true" : "false"}
        disabled={disabled}
        className="h-10 w-28 text-sm"
        options={[
          { value: "true", label: t("yes") },
          { value: "false", label: t("no") },
        ]}
        onValueChange={(v) => onChange(v === "true")}
      />
    );
  }

  if (def.valueType === "number") {
    if (def.unit === "minutes") {
      return (
        <DurationInput
          minutes={typeof value === "number" ? value : 0}
          disabled={disabled}
          onChange={(m) => onChange(m)}
        />
      );
    }
    return (
      <Input
        type="number"
        className="h-8 w-24 text-xs"
        disabled={disabled}
        value={typeof value === "number" ? value : ""}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? n : 0);
        }}
      />
    );
  }

  if (options) {
    if (multi) {
      const chosen = Array.isArray(value) ? value.map(String) : [];
      return (
        <MultiPicker
          options={options}
          chosen={chosen}
          disabled={disabled}
          onChange={(next) => onChange(next)}
        />
      );
    }
    return (
      <LabeledSelect
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        className="h-10 min-w-[12rem] flex-1 text-sm"
        placeholder={t("choose")}
        options={options}
        onValueChange={(v) => onChange(v)}
      />
    );
  }

  return (
    <Input
      className="h-8 min-w-[10rem] flex-1 text-xs"
      disabled={disabled}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function optionsFor(
  def: ClientFieldDef,
  refs: RuleRefs,
): { value: string; label: string }[] | null {
  if (def.valueType === "enum" && def.options) {
    return def.options.map((v) => ({ value: v, label: valueLabel(v) }));
  }
  if (def.valueType !== "reference") return null;
  switch (def.reference) {
    case "user":
      return refs.users.map((u) => ({ value: u.id, label: u.name }));
    // Roles are matched BY NAME, not by id: "the IT Director" has to keep
    // working after a handover, and a renamed role is a broken reference the
    // engine reports rather than a silent mismatch.
    case "role":
      return refs.roles.map((r) => ({ value: r.name, label: r.name }));
    case "organization":
      return refs.organizations.map((o) => ({ value: o.id, label: o.name }));
    case "category":
      return refs.categories.map((c) => ({ value: c.value, label: c.label }));
    case "ticket_type":
      return refs.ticketTypes.map((c) => ({ value: c.value, label: c.label }));
    default:
      return null;
  }
}

function MultiPicker({
  options,
  chosen,
  onChange,
  disabled,
}: {
  options: { value: string; label: string }[];
  chosen: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative min-w-[10rem] flex-1">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-full items-center justify-between gap-1 rounded-md border border-zinc-300 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-950"
      >
        <span className="truncate">
          {chosen.length === 0
            ? "choose…"
            : chosen
                .map((v) => options.find((o) => o.value === v)?.label ?? v)
                .join(", ")}
        </span>
        <ChevronDown className="size-3 shrink-0 text-zinc-400" aria-hidden="true" />
      </button>
      {open ? (
        <span className="absolute left-0 z-30 mt-1 block max-h-56 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {options.map((o) => {
            const on = chosen.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() =>
                  onChange(
                    on ? chosen.filter((v) => v !== o.value) : [...chosen, o.value],
                  )
                }
                className="flex w-full items-center justify-between px-2 py-1 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                {o.label}
                {on ? (
                  <Check className="size-3 text-emerald-600" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </span>
      ) : null}
    </span>
  );
}

// ── Actions ───────────────────────────────────────────────────────────

function ActionRow({
  action,
  catalog,
  refs,
  disabled,
  onChange,
  onRemove,
}: {
  action: RuleAction;
  catalog: ClientCatalog;
  refs: RuleRefs;
  disabled?: boolean;
  onChange: (a: RuleAction) => void;
  onRemove?: () => void;
}) {
  const t = useTranslations("automations.rules");
  const safe = new Set(catalog.safeActions);

  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
      <div className="flex items-center gap-1.5">
        <LabeledSelect
          value={action.type}
          disabled={disabled}
          className="h-10 min-w-[16rem] flex-1 text-sm"
          aria-label={t("thenHeading")}
          options={Object.keys(catalog.actions).map((type) => ({
            value: type,
            // Mutating actions are listed but not selectable: showing the
            // shape of what is coming beats a mysteriously short menu.
            label:
              cap(ACTION_LABELS[type as RuleAction["type"]]) +
              (safe.has(type) ? "" : ` — ${t("notYet")}`),
            disabled: !safe.has(type),
          }))}
          onValueChange={(v) => onChange(defaultActionOf(v as RuleAction["type"]))}
        />
        {onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={disabled}
            aria-label={t("removeAction")}
            onClick={onRemove}
          >
            <Trash2 className="size-3" aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      {action.type === "notify" ? (
        <NotifyFields
          action={action}
          refs={refs}
          disabled={disabled}
          onChange={onChange}
        />
      ) : null}

      {action.type === "internal_note" ? (
        <MessageField
          label={t("noteLabel")}
          value={action.body}
          disabled={disabled}
          onChange={(body) => onChange({ ...action, body })}
        />
      ) : null}

      {action.type === "flag" ? (
        <MessageField
          label={t("flagLabel")}
          value={action.reason}
          disabled={disabled}
          onChange={(reason) => onChange({ ...action, reason })}
        />
      ) : null}

      {action.type === "webhook" ? (
        <div className="grid gap-1.5 sm:grid-cols-2">
          <Input
            className="h-8 text-xs"
            placeholder="https://…"
            disabled={disabled}
            value={action.url}
            onChange={(e) => onChange({ ...action, url: e.target.value })}
          />
          <Input
            className="h-8 text-xs"
            placeholder={t("webhookSecret")}
            disabled={disabled}
            value={action.secret ?? ""}
            onChange={(e) => onChange({ ...action, secret: e.target.value })}
          />
        </div>
      ) : null}
    </div>
  );
}

function defaultActionOf(type: RuleAction["type"]): RuleAction {
  switch (type) {
    case "notify":
      return {
        type: "notify",
        channels: ["in_app"],
        audiences: ["assignee"],
        body: "{ticketNumber} — {subject}",
      };
    case "internal_note":
      return { type: "internal_note", body: "{ticketNumber} matched this rule." };
    case "webhook":
      return { type: "webhook", url: "" };
    default:
      return { type: "flag", reason: "{ticketNumber} matched." };
  }
}

function NotifyFields({
  action,
  refs,
  disabled,
  onChange,
}: {
  action: Extract<RuleAction, { type: "notify" }>;
  refs: RuleRefs;
  disabled?: boolean;
  onChange: (a: RuleAction) => void;
}) {
  const t = useTranslations("automations.rules");
  const toggle = <T extends string>(list: T[], v: T): T[] =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  return (
    <div className="space-y-2">
      <div>
        <p className="mb-1 text-[11px] font-medium text-zinc-500">{t("channels")}</p>
        <div className="flex flex-wrap gap-1">
          {(["in_app", "email", "sms"] as NotifyChannel[]).map((c) => (
            <Chip
              key={c}
              on={action.channels.includes(c)}
              disabled={disabled}
              label={CHANNEL_LABELS[c]}
              onClick={() => onChange({ ...action, channels: toggle(action.channels, c) })}
            />
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 text-[11px] font-medium text-zinc-500">{t("audiences")}</p>
        <div className="flex flex-wrap gap-1">
          {(
            [
              "assignee",
              "customer",
              "participants",
              "org_trusted_contacts",
              "escalation_target_role",
              "named_users",
              "named_roles",
              "named_emails",
            ] as NotifyAudience[]
          ).map((a) => (
            <Chip
              key={a}
              on={action.audiences.includes(a)}
              disabled={disabled}
              label={AUDIENCE_LABELS[a]}
              onClick={() =>
                onChange({ ...action, audiences: toggle(action.audiences, a) })
              }
            />
          ))}
        </div>
      </div>

      {action.audiences.includes("named_users") ? (
        <MultiPicker
          options={refs.users.map((u) => ({ value: u.id, label: u.name }))}
          chosen={action.userIds ?? []}
          disabled={disabled}
          onChange={(userIds) => onChange({ ...action, userIds })}
        />
      ) : null}
      {action.audiences.includes("named_roles") ? (
        <MultiPicker
          options={refs.roles.map((r) => ({ value: r.name, label: r.name }))}
          chosen={action.roles ?? []}
          disabled={disabled}
          onChange={(roles) => onChange({ ...action, roles })}
        />
      ) : null}
      {action.audiences.includes("named_emails") ? (
        <Input
          className="h-8 text-xs"
          placeholder={t("emailsPlaceholder")}
          disabled={disabled}
          value={(action.emails ?? []).join(", ")}
          onChange={(e) =>
            onChange({
              ...action,
              emails: e.target.value
                .split(",")
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean),
            })
          }
        />
      ) : null}

      <Input
        className="h-8 text-xs"
        placeholder={t("subjectPlaceholder")}
        disabled={disabled}
        value={action.subject ?? ""}
        onChange={(e) => onChange({ ...action, subject: e.target.value })}
      />
      <MessageField
        label={t("messageLabel")}
        value={action.body}
        disabled={disabled}
        onChange={(body) => onChange({ ...action, body })}
      />
    </div>
  );
}

function Chip({
  on,
  label,
  onClick,
  disabled,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-50",
        on
          ? "border-blue-500 bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
          : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800",
      )}
    >
      {label}
    </button>
  );
}

/** A message box that warns about a mistyped placeholder while you type. */
function MessageField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("automations.rules");
  const [showAll, setShowAll] = useState(false);
  const unknown = unknownPlaceholders(value);

  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-zinc-500">{label}</Label>
      <Textarea
        rows={2}
        className="text-xs"
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {unknown.length > 0 ? (
        <p className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-3" aria-hidden="true" />
          {t("unknownPlaceholders", { names: unknown.join(", ") })}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => setShowAll((v) => !v)}
        className="text-[11px] text-zinc-500 underline-offset-2 hover:underline"
      >
        {showAll ? t("hidePlaceholders") : t("showPlaceholders")}
      </button>
      {showAll ? (
        <div className="space-y-1.5">
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {t("placeholderHint")}
        </p>
        <p className="flex flex-wrap gap-1.5">
          {PLACEHOLDERS.map((p) => (
            <button
              key={p}
              type="button"
              disabled={disabled}
              onClick={() => onChange(`${value}{${p}}`)}
              title={`{${p}}`}
              className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700 hover:border-blue-400 hover:bg-blue-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-blue-600 dark:hover:bg-blue-950/40"
            >
              + {PLACEHOLDER_LABELS[p]}
            </button>
          ))}
        </p>
        </div>
      ) : null}
    </div>
  );
}
