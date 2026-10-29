import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import {
  Activity,
  CircleAlert,
  CirclePause,
  Clock,
  Gauge,
  Mail,
  Receipt,
  Repeat,
  Sparkles,
  Timer,
  Trash2,
  Wand2,
  Workflow,
  Zap,
} from "lucide-react";
import { JobPane } from "@/components/automations/job-pane";
import {
  JobRow,
  RunList,
  SimplePager,
  scheduleText,
} from "@/components/automations/job-views";
import { AutomationToggle } from "@/components/automations/automation-toggle";
import { RulesManager } from "@/components/automations/rules-manager";
import { ScheduledReportsManager } from "@/components/automations/scheduled-reports-manager";
import { SlaTargetsForm } from "@/components/settings/sla-form";
import { Pagination, parsePage, parsePageSize } from "@/components/ui/pagination";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { requireSessionUser } from "@/lib/auth/session";
import {
  type AutomationCard,
  loadAutomationPanel,
} from "@/lib/automations/panel";
import {
  AUTOMATION_BY_ID,
  type AutomationCategory,
} from "@/lib/automations/registry";
import { listRunsPage } from "@/lib/automations/runs";
import { loadRulesPanelSafe } from "@/lib/rules/panel";
import {
  canUpdateSetting,
  canViewSetting,
  settingsAccessFor,
} from "@/lib/settings-access";
import type { SettingKey } from "@/lib/settings-registry";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("automations");
  return { title: t("metaTitle") };
}

// ── Layout ────────────────────────────────────────────────────────────
//
// A LIST of automations, organised into tabs, with the detail and the history
// of each one in a side pane opened by clicking it. The page used to be one
// very long scroll: every job as a tall card, then the reports, the SLA form,
// the event-driven jobs and finally a global history. A tab shows one of those
// at a time, and history now belongs to the automation it describes.
//
// All state is in the URL — `tab`, `job` (which pane is open), `hpage` (that
// pane's history page), `page`/`pageSize`/`status` (the Activity tab) — so
// every view is a link, survives a refresh, and loads only what it shows.

const TABS = [
  "rules",
  "jobs",
  "background",
  "reports",
  "sla",
  "activity",
] as const;
type Tab = (typeof TABS)[number];

const TAB_ICON: Record<Tab, typeof Clock> = {
  rules: Wand2,
  jobs: Clock,
  background: Zap,
  reports: Mail,
  sla: Gauge,
  activity: Activity,
};

const CATEGORY_ICON: Record<AutomationCategory, typeof Clock> = {
  sla: Gauge,
  lifecycle: Repeat,
  billing: Receipt,
  housekeeping: Trash2,
  reports: Mail,
  intake: Mail,
  notifications: Zap,
  rules: Workflow,
};

/** Order the groups appear in: the ones that affect customers first. */
const CATEGORY_ORDER: AutomationCategory[] = [
  "rules",
  "sla",
  "lifecycle",
  "reports",
  "billing",
  "housekeeping",
  "intake",
  "notifications",
];

const HISTORY_PAGE_SIZE = 10;

type SP = {
  tab?: string;
  job?: string;
  hpage?: string;
  page?: string;
  pageSize?: string;
  status?: string;
};

export default async function AutomationsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const user = await requireSessionUser();
  // Opens for either settings tier, like the Settings page beside it. Each
  // switch goes through `updateSetting`, which re-checks the permission for
  // that KEY's tier — so what a viewer is offered below matches what they could
  // actually change.
  const access = await settingsAccessFor(user);
  if (!access.viewAny) notFound();

  const canEdit = access.updateBusiness;
  // Rules are their own permission, not a reading of settings.update.
  const canManageRules = await can(
    user,
    "rules.manage",
    { type: "global" },
    productionContext,
  );

  const sp = await searchParams;
  const available = TABS.filter((id) => {
    if (id === "rules") return canManageRules;
    if (id === "reports" || id === "sla") return canEdit;
    return true;
  });
  const tab: Tab = (available as readonly string[]).includes(sp.tab ?? "")
    ? (sp.tab as Tab)
    : (available[0] ?? "jobs");

  const [panel, rules] = await Promise.all([
    loadAutomationPanel(),
    canManageRules && tab === "rules"
      ? loadRulesPanelSafe()
      : Promise.resolve({ installed: false as const, reason: "" }),
  ]);

  const t = await getTranslations("automations");
  const tJobs = await getTranslations("automations.jobs");
  const format = await getFormatter();

  // ── URLs ──
  const href = (over: Partial<Record<keyof SP, string | undefined>> = {}) => {
    const merged: Record<string, string | undefined> = {
      tab,
      job: sp.job,
      hpage: sp.hpage,
      page: sp.page,
      pageSize: sp.pageSize,
      status: sp.status,
      ...over,
    };
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    const qs = q.toString();
    return qs ? `/admin/automations?${qs}` : "/admin/automations";
  };
  /** The URL for opening one automation's pane from here. */
  const openJob = (id: string) => href({ job: id, hpage: undefined });
  /** The same view with the pane closed. */
  const closeHref = href({ job: undefined, hpage: undefined });

  // ── Header numbers ──
  const failing = panel.scheduled.filter((c) => c.failures24h > 0).length;
  const paused = panel.scheduled.filter(
    (c) => c.enabledKey !== null && !c.enabled,
  ).length;
  // Same source the rule dispatchers' own cards read, so the two agree.
  const rulesEngineOn =
    panel.scheduled.find((c) => c.def.id === "rule-event-dispatcher")?.enabled ??
    true;

  const canToggle = (card: AutomationCard) =>
    card.enabledKey !== null &&
    canUpdateSetting(access, card.enabledKey as SettingKey);

  const grouped = (cards: AutomationCard[]) =>
    CATEGORY_ORDER.map((category) => ({
      category,
      cards: cards.filter((c) => c.def.category === category),
    })).filter((g) => g.cards.length > 0);

  // ── The side pane, if one is open ──
  const openCard =
    sp.job && AUTOMATION_BY_ID.has(sp.job)
      ? [...panel.scheduled, ...panel.reactive].find((c) => c.def.id === sp.job)
      : undefined;
  const hpage = parsePage(sp.hpage);
  const history =
    openCard && openCard.def.tracked
      ? await listRunsPage({
          automationId: openCard.def.id,
          page: hpage,
          pageSize: HISTORY_PAGE_SIZE,
        })
      : null;

  // ── The Activity tab ──
  const activityPage = parsePage(sp.page);
  const activitySize = parsePageSize(sp.pageSize);
  const errorsOnly = sp.status === "error";
  const activity =
    tab === "activity"
      ? await listRunsPage({
          errorsOnly,
          page: activityPage,
          pageSize: activitySize,
        })
      : null;

  const tabBadge: Partial<Record<Tab, { n: number; bad?: boolean }>> = {
    rules: rules.installed ? { n: rules.panel.rules.length } : undefined,
    jobs: { n: panel.scheduled.length, bad: failing > 0 },
    background: { n: panel.reactive.length },
    reports: { n: panel.reports.length },
  };

  return (
    <div className="w-full space-y-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
            <Sparkles className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold leading-tight">{t("title")}</h1>
            <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">
              {t("subtitle")}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Stat icon={Clock} value={panel.scheduled.length} label={t("statScheduled")} />
          <Stat icon={Zap} value={panel.reactive.length} label={t("statReactive")} />
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
            {t("clock", { timezone: panel.timezone, localNow: panel.localNow })}
          </span>
        </div>
      </header>

      {/* ── Tabs ────────────────────────────────────────────────────── */}
      <nav
        aria-label={t("title")}
        className="-mt-1 flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800"
      >
        {available.map((id) => {
          const Icon = TAB_ICON[id];
          const badge = tabBadge[id];
          const active = id === tab;
          return (
            <Link
              key={id}
              // Switching tab drops the pane and every page counter: they
              // belonged to the view being left.
              href={`/admin/automations?tab=${id}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "border-blue-600 text-blue-700 dark:border-blue-500 dark:text-blue-400"
                  : "border-transparent text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-100",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {t(`tabs.${id}`)}
              {badge ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                    badge.bad
                      ? "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300"
                      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
                  )}
                >
                  {badge.n}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* ── Your rules ──────────────────────────────────────────────── */}
      {tab === "rules" ? (
        rules.installed ? (
          <RulesManager
            rules={rules.panel.rules}
            refs={rules.panel.refs}
            catalog={rules.panel.catalog}
            backlog={rules.panel.backlog}
            engineEnabled={rulesEngineOn}
            timezone={panel.timezone}
          />
        ) : (
          <p className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            {t("rules.notInstalled")}
          </p>
        )
      ) : null}

      {/* ── Scheduled jobs ──────────────────────────────────────────── */}
      {tab === "jobs" ? (
        <section className="space-y-5">
          <TabIntro title={t("scheduledHeading")} hint={t("scheduledHint")} />
          {grouped(panel.scheduled).map((group) => (
            <CategoryGroup
              key={group.category}
              icon={CATEGORY_ICON[group.category]}
              title={t(`category.${group.category}`)}
            >
              {group.cards.map((card) => (
                <JobRow
                  key={card.def.id}
                  card={card}
                  href={openJob(card.def.id)}
                  selected={sp.job === card.def.id}
                  canToggle={canToggle(card)}
                  t={t}
                  tJobs={tJobs}
                  format={format}
                />
              ))}
            </CategoryGroup>
          ))}
        </section>
      ) : null}

      {/* ── Background services ─────────────────────────────────────── */}
      {tab === "background" ? (
        <section className="space-y-5">
          <TabIntro title={t("reactiveHeading")} hint={t("reactiveHint")} />
          {grouped(panel.reactive).map((group) => (
            <CategoryGroup
              key={group.category}
              icon={CATEGORY_ICON[group.category]}
              title={t(`category.${group.category}`)}
            >
              {group.cards.map((card) => (
                <JobRow
                  key={card.def.id}
                  card={card}
                  href={openJob(card.def.id)}
                  selected={sp.job === card.def.id}
                  canToggle={false}
                  t={t}
                  tJobs={tJobs}
                  format={format}
                />
              ))}
            </CategoryGroup>
          ))}
        </section>
      ) : null}

      {/* ── Scheduled reports ───────────────────────────────────────── */}
      {tab === "reports" && canEdit ? (
        <ScheduledReportsManager
          reports={panel.reports}
          staff={panel.staff}
          roleNames={panel.roleNames}
          timezone={panel.timezone}
        />
      ) : null}

      {/* ── SLA targets ─────────────────────────────────────────────── */}
      {tab === "sla" && canEdit ? (
        <section className="max-w-4xl space-y-3">
          <TabIntro title={t("slaHeading")} hint={t("slaHint")} />
          <SlaTargetsForm initial={panel.sla} />
        </section>
      ) : null}

      {/* ── Activity ────────────────────────────────────────────────── */}
      {tab === "activity" && activity ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <TabIntro title={t("activity.heading")} hint={t("activity.hint")} />
            <div className="flex gap-1.5">
              {(
                [
                  ["all", false],
                  ["error", true],
                ] as const
              ).map(([key, isErrors]) => (
                <Link
                  key={key}
                  href={href({
                    status: isErrors ? "error" : undefined,
                    page: undefined,
                    job: undefined,
                    hpage: undefined,
                  })}
                  className={cn(
                    "rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                    errorsOnly === isErrors
                      ? "border-blue-500 bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                      : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800",
                  )}
                >
                  {t(isErrors ? "activity.failedOnly" : "activity.all")}
                </Link>
              ))}
            </div>
          </div>

          {activity.rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              {errorsOnly ? t("activity.noFailures") : t("activityEmpty")}
            </p>
          ) : (
            <RunList
              runs={activity.rows}
              t={t}
              format={format}
              nameFor={(run) =>
                AUTOMATION_BY_ID.has(run.automationId)
                  ? tJobs(`${run.automationId}.name`)
                  : run.automationId.startsWith("scheduled-report:")
                    ? t("activity.report")
                    : run.automationId
              }
              hrefFor={(run) =>
                AUTOMATION_BY_ID.has(run.automationId)
                  ? openJob(run.automationId)
                  : null
              }
            />
          )}

          <Pagination
            pathname="/admin/automations"
            page={activityPage}
            pageSize={activitySize}
            totalItems={activity.total}
            searchParams={
              new URLSearchParams(
                Object.entries({
                  tab,
                  status: sp.status,
                  pageSize: sp.pageSize,
                }).filter(([, v]) => v) as [string, string][],
              )
            }
          />
        </section>
      ) : null}

      {/* ── The side pane ───────────────────────────────────────────── */}
      {openCard ? (
        <JobPane
          title={tJobs(`${openCard.def.id}.name`)}
          subtitle={t(`category.${openCard.def.category}`)}
          closeHref={closeHref}
        >
          <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">
            {tJobs(`${openCard.def.id}.description`)}
          </p>

          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-3 rounded-lg border border-zinc-200 bg-zinc-50/60 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900/40">
            <dt className="text-zinc-500 dark:text-zinc-400">{t("pane.runs")}</dt>
            <dd className="font-medium">
              {openCard.def.kind === "scheduled"
                ? scheduleText(openCard, t)
                : t("pane.onEvent")}
            </dd>

            {openCard.def.kind === "scheduled" ? (
              <>
                <dt className="text-zinc-500 dark:text-zinc-400">{t("pane.status")}</dt>
                <dd>
                  {openCard.enabledKey && canToggle(openCard) ? (
                    <AutomationToggle
                      settingKey={openCard.enabledKey}
                      enabled={openCard.enabled}
                      label={tJobs(`${openCard.def.id}.name`)}
                    />
                  ) : (
                    <span className="font-medium">
                      {openCard.enabledKey && !openCard.enabled
                        ? t("pane.switchedOff")
                        : t("pane.on")}
                    </span>
                  )}
                </dd>
              </>
            ) : null}

            {openCard.settings
              .filter((s) => canViewSetting(access, s.key as SettingKey))
              .map((s) => (
                <PaneSetting key={s.key} s={s} t={t} />
              ))}
          </dl>

          {/* History belongs to the automation it describes, so it lives here
              rather than in one long list at the bottom of the page. */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t("pane.history")}</h3>
            {!openCard.def.tracked ? (
              <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                {t("pane.notTracked")}
              </p>
            ) : history && history.rows.length > 0 ? (
              <>
                <RunList runs={history.rows} t={t} format={format} />
                <SimplePager
                  page={hpage}
                  pageSize={HISTORY_PAGE_SIZE}
                  total={history.total}
                  hrefFor={(p) => href({ hpage: p > 1 ? String(p) : undefined })}
                  t={(k, v) => t(`pager.${k}`, v)}
                />
              </>
            ) : (
              <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                {t("pane.historyEmpty")}
              </p>
            )}
          </section>
        </JobPane>
      ) : null}
    </div>
  );
}

// ── Pieces ────────────────────────────────────────────────────────────

type T = Awaited<ReturnType<typeof getTranslations<"automations">>>;

function TabIntro({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-0.5 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
        {hint}
      </p>
    </div>
  );
}

function CategoryGroup({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Clock;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        <Icon className="size-3.5" aria-hidden="true" />
        {title}
      </h3>
      {/* Two columns on a wide screen: the page uses its full width now, and a
          single column of rows would leave the right half empty. */}
      <div className="grid gap-2 xl:grid-cols-2">{children}</div>
    </div>
  );
}

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

function PaneSetting({
  s,
  t,
}: {
  s: AutomationCard["settings"][number];
  t: T;
}) {
  return (
    <>
      <dt className="text-zinc-500 dark:text-zinc-400">{s.label}</dt>
      <dd className="font-medium">{renderValue(s, t)}</dd>
    </>
  );
}

function renderValue(s: AutomationCard["settings"][number], t: T): string {
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
