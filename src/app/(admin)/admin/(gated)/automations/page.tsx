import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import {
  Activity,
  CircleAlert,
  CircleCheck,
  CircleMinus,
  CirclePause,
  Clock,
  Gauge,
  Mail,
  Receipt,
  Repeat,
  Sparkles,
  Timer,
  Trash2,
  Zap,
} from "lucide-react";
import { AutomationToggle } from "@/components/automations/automation-toggle";
import { ScheduledReportsManager } from "@/components/automations/scheduled-reports-manager";
import { SlaTargetsForm } from "@/components/settings/sla-form";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { requireSessionUser } from "@/lib/auth/session";
import {
  type AutomationCard,
  loadAutomationPanel,
} from "@/lib/automations/panel";
import { AUTOMATION_BY_ID, type AutomationCategory } from "@/lib/automations/registry";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("automations");
  return { title: t("metaTitle") };
}

const CATEGORY_ICON: Record<AutomationCategory, typeof Clock> = {
  sla: Gauge,
  lifecycle: Repeat,
  billing: Receipt,
  housekeeping: Trash2,
  reports: Mail,
  intake: Mail,
  notifications: Zap,
};

/** Order the groups appear in: the ones that affect customers first. */
const CATEGORY_ORDER: AutomationCategory[] = [
  "sla",
  "lifecycle",
  "reports",
  "billing",
  "housekeeping",
  "intake",
  "notifications",
];

export default async function AutomationsPage() {
  const user = await requireSessionUser();
  // Read is `settings.view`, same as the Settings page it sits beside. The
  // switches go through `updateSetting`, which re-checks `settings.update` —
  // so a viewer sees the panel and cannot change it.
  if (
    !(await can(user, "settings.view", { type: "global" }, productionContext))
  ) {
    notFound();
  }
  const canEdit = await can(
    user,
    "settings.update",
    { type: "global" },
    productionContext,
  );

  const panel = await loadAutomationPanel();
  const t = await getTranslations("automations");
  const tJobs = await getTranslations("automations.jobs");
  const format = await getFormatter();

  const failing = panel.scheduled.filter((c) => c.failures24h > 0).length;
  const paused = panel.scheduled.filter(
    (c) => c.enabledKey !== null && !c.enabled,
  ).length;

  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    cards: panel.scheduled.filter((c) => c.def.category === category),
  })).filter((g) => g.cards.length > 0);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
            <Sparkles className="size-4.5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-xl font-semibold leading-tight">{t("title")}</h1>
            <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">
              {t("subtitle")}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Stat
            icon={Clock}
            value={panel.scheduled.length}
            label={t("statScheduled")}
          />
          <Stat
            icon={Zap}
            value={panel.reactive.length}
            label={t("statReactive")}
          />
          <Stat
            icon={CircleAlert}
            value={failing}
            label={t("statFailing")}
            tone={failing > 0 ? "bad" : "neutral"}
          />
          <Stat
            icon={CirclePause}
            value={paused}
            label={t("statPaused")}
            tone={paused > 0 ? "warn" : "neutral"}
          />
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            <Timer className="size-3.5 text-zinc-400" aria-hidden="true" />
            {t("clock", {
              timezone: panel.timezone,
              localNow: panel.localNow,
            })}
          </span>
        </div>
      </header>

      {/* ── Scheduled, grouped ──────────────────────────────────────── */}
      <section className="space-y-5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Clock className="size-4 text-amber-500" aria-hidden="true" />
            {t("scheduledHeading")}
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {t("scheduledHint")}
          </p>
        </div>

        {groups.map((group) => {
          const Icon = CATEGORY_ICON[group.category];
          return (
            <div key={group.category} className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                <Icon className="size-3.5" aria-hidden="true" />
                {t(`category.${group.category}`)}
              </h3>
              <ul className="space-y-2">
                {group.cards.map((card) => (
                  <li key={card.def.id}>
                    <JobCard
                      card={card}
                      canEdit={canEdit}
                      t={t}
                      tJobs={tJobs}
                      format={format}
                    />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      {/* ── Scheduled reports ───────────────────────────────────────── */}
      {canEdit ? (
        <ScheduledReportsManager
          reports={panel.reports}
          staff={panel.staff}
          roleNames={panel.roleNames}
          timezone={panel.timezone}
        />
      ) : null}

      {/* ── SLA targets ─────────────────────────────────────────────── */}
      {canEdit ? (
        <section className="space-y-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Gauge className="size-4 text-rose-500" aria-hidden="true" />
              {t("slaHeading")}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {t("slaHint")}
            </p>
          </div>
          <SlaTargetsForm initial={panel.sla} />
        </section>
      ) : null}

      {/* ── Reactive ────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Zap className="size-4 text-violet-500" aria-hidden="true" />
            {t("reactiveHeading")}
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {t("reactiveHint")}
          </p>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {panel.reactive.map((card) => (
            <li
              key={card.def.id}
              className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <p className="text-sm font-medium">
                {tJobs(`${card.def.id}.name`)}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                {tJobs(`${card.def.id}.description`)}
              </p>
              <p className="mt-1.5 inline-flex items-center gap-1 rounded bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
                <Zap className="size-2.5" aria-hidden="true" />
                {t("triggeredBy")}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Recent activity ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Activity className="size-4 text-sky-500" aria-hidden="true" />
          {t("activityHeading")}
        </h2>
        {panel.recentRuns.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            {t("activityEmpty")}
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {panel.recentRuns.map((run) => {
              const def = AUTOMATION_BY_ID.get(run.automationId);
              return (
                <li
                  key={run.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-white px-3 py-2 text-xs dark:bg-zinc-900"
                >
                  <StatusChip status={run.status} t={t} />
                  <span className="min-w-0 flex-1 font-medium">
                    {def
                      ? tJobs(`${run.automationId}.name`)
                      : run.automationId}
                  </span>
                  <span className="shrink-0 text-zinc-400 dark:text-zinc-500">
                    {format.relativeTime(new Date(run.startedAt), {
                      now: new Date(),
                    })}
                  </span>
                  <span className="w-full truncate text-[11px] text-zinc-500 dark:text-zinc-400 sm:w-auto sm:max-w-[45%]">
                    {run.error ?? summarize(run.summary)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"automations">>>;
type TJobs = Awaited<ReturnType<typeof getTranslations<"automations.jobs">>>;
type Fmt = Awaited<ReturnType<typeof getFormatter>>;

function Stat({
  icon: Icon,
  value,
  label,
  tone = "neutral",
}: {
  icon: typeof Clock;
  value: number;
  label: string;
  tone?: "neutral" | "warn" | "bad";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs",
        tone === "bad" &&
          "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
        tone === "warn" &&
          "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
        tone === "neutral" &&
          "border-zinc-200 bg-white text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
      )}
    >
      <Icon className="size-3.5 opacity-70" aria-hidden="true" />
      <span className="font-semibold tabular-nums">{value}</span>
      {label}
    </span>
  );
}

function JobCard({
  card,
  canEdit,
  t,
  tJobs,
  format,
}: {
  card: AutomationCard;
  canEdit: boolean;
  t: T;
  tJobs: TJobs;
  format: Fmt;
}) {
  const off = card.enabledKey !== null && !card.enabled;
  const broken = card.failures24h > 0;
  return (
    <div
      className={cn(
        // A coloured left edge so a failing or paused job is findable without
        // reading every card.
        "rounded-lg border border-l-4 bg-white p-3 dark:bg-zinc-900",
        broken
          ? "border-zinc-200 border-l-red-500 dark:border-zinc-800"
          : off
            ? "border-zinc-200 border-l-zinc-300 dark:border-zinc-800 dark:border-l-zinc-600"
            : "border-zinc-200 border-l-emerald-500 dark:border-zinc-800",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-sm font-medium",
              off && "text-zinc-500 dark:text-zinc-400",
            )}
          >
            {tJobs(`${card.def.id}.name`)}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
            {tJobs(`${card.def.id}.description`)}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded bg-zinc-50 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
              <Clock className="size-3 opacity-60" aria-hidden="true" />
              {scheduleText(card, t)}
            </span>
            {card.def.tracked ? <RunChip card={card} t={t} format={format} /> : null}
            {broken ? (
              <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300">
                <CircleAlert className="size-3" aria-hidden="true" />
                {t("failures24h", { count: card.failures24h })}
              </span>
            ) : null}
          </div>

          {card.settings.length > 0 ? (
            <dl className="mt-2 flex flex-wrap gap-1.5">
              {card.settings.map((s) => (
                <div
                  key={s.key}
                  className="inline-flex items-baseline gap-1 rounded border border-zinc-200 px-1.5 py-0.5 text-[11px] dark:border-zinc-800"
                >
                  <dt className="text-zinc-500 dark:text-zinc-400">
                    {s.label}
                  </dt>
                  <dd className="font-medium text-zinc-700 dark:text-zinc-200">
                    {renderValue(s, t)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>

        <div className="shrink-0">
          {card.enabledKey && canEdit ? (
            <AutomationToggle
              settingKey={card.enabledKey}
              enabled={card.enabled}
              label={tJobs(`${card.def.id}.name`)}
            />
          ) : (
            <span className="inline-flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              {card.enabledKey ? t("readOnly") : t("alwaysOn")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function scheduleText(card: AutomationCard, t: T): string {
  const s = card.schedule;
  if (!s) return t("scheduleUnknown");
  switch (s.kind) {
    case "everyNMinutes":
      return t("everyMinutes", { n: s.n });
    case "everyNHours":
      return t("everyHours", { n: s.n });
    case "hourly":
      return t("hourly");
    case "dailyAt":
      return t("dailyAt", { time: s.localTime });
    case "raw":
      return card.def.cron ?? t("scheduleUnknown");
  }
}

function RunChip({
  card,
  t,
  format,
}: {
  card: AutomationCard;
  t: T;
  format: Fmt;
}) {
  if (!card.lastRun) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
        <CircleMinus className="size-3" aria-hidden="true" />
        {t("neverRun")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusChip status={card.lastRun.status} t={t} />
      <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
        {format.relativeTime(new Date(card.lastRun.startedAt), {
          now: new Date(),
        })}
      </span>
    </span>
  );
}

function StatusChip({ status, t }: { status: string; t: T }) {
  const map = {
    ok: {
      Icon: CircleCheck,
      cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
      label: t("statusOk"),
    },
    error: {
      Icon: CircleAlert,
      cls: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300",
      label: t("statusError"),
    },
    skipped: {
      Icon: CircleMinus,
      cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
      label: t("statusSkipped"),
    },
    running: {
      Icon: Clock,
      cls: "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
      label: t("statusRunning"),
    },
  } as const;
  const entry = map[status as keyof typeof map] ?? map.running;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium",
        entry.cls,
      )}
    >
      <entry.Icon className="size-3" aria-hidden="true" />
      {entry.label}
    </span>
  );
}

/** A run's return value, compressed to one readable line. */
function summarize(summary: unknown): string {
  if (summary === null || summary === undefined) return "—";
  if (typeof summary !== "object") return String(summary);
  const entries = Object.entries(summary as Record<string, unknown>);
  if (entries.length === 0) return "—";
  return entries
    .map(
      ([k, v]) =>
        `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`,
    )
    .join(" · ");
}

function renderValue(
  s: AutomationCard["settings"][number],
  t: T,
): string {
  const { value, unit } = s;
  if (value === null || value === undefined) return t("valueDefault");
  if (typeof value === "boolean") return value ? t("on") : t("off");
  if (Array.isArray(value)) {
    return value.length === 0 ? t("valueNone") : value.join(", ");
  }
  if (typeof value === "number" && unit) {
    return unit === "minutes"
      ? t("unitMinutes", { n: value })
      : unit === "hours"
        ? t("unitHours", { n: value })
        : t("unitDays", { n: value });
  }
  return String(value);
}
