import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { CircleAlert, CircleCheck, CircleSlash, Clock, Zap } from "lucide-react";
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
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("automations");
  return { title: t("metaTitle") };
}

export default async function AutomationsPage() {
  const user = await requireSessionUser();
  // Read is `settings.view`, same as the Settings page it sits beside. The
  // switches themselves go through `updateSetting`, which re-checks
  // `settings.update` — so a viewer sees the panel and cannot change it.
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

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          {t("subtitle")}
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {t("clock", { timezone: panel.timezone, localNow: panel.localNow })}
        </p>
      </header>

      {/* ── Scheduled ───────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-amber-500" aria-hidden="true" />
          <h2 className="text-base font-semibold">{t("scheduledHeading")}</h2>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {t("scheduledHint")}
        </p>
        <ul className="space-y-2">
          {panel.scheduled.map((card) => (
            <li
              key={card.def.id}
              className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{tJobs(`${card.def.id}.name`)}</p>
                  <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-300">
                    {tJobs(`${card.def.id}.description`)}
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                    {scheduleLine(card, t)}
                  </p>
                  <RunLine card={card} t={t} format={format} />
                  {card.settings.length > 0 ? (
                    <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                      {card.settings.map((s) => (
                        <div key={s.key} className="flex gap-1 text-[11px]">
                          <dt className="text-zinc-500 dark:text-zinc-400">
                            {t("settingLabel", { key: s.key })}
                          </dt>
                          <dd className="font-medium text-zinc-700 dark:text-zinc-200">
                            {renderValue(s.value, t)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </div>
                {card.enabledKey && canEdit ? (
                  <AutomationToggle
                    settingKey={card.enabledKey}
                    enabled={card.enabled}
                    label={tJobs(`${card.def.id}.name`)}
                  />
                ) : (
                  <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-px text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    {card.enabledKey ? t("readOnly") : t("alwaysOn")}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
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
          <h2 className="text-base font-semibold">{t("slaHeading")}</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("slaHint")}
          </p>
          <SlaTargetsForm initial={panel.sla} />
        </section>
      ) : null}

      {/* ── Reactive ────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="size-4 text-violet-500" aria-hidden="true" />
          <h2 className="text-base font-semibold">{t("reactiveHeading")}</h2>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {t("reactiveHint")}
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {panel.reactive.map((card) => (
            <li
              key={card.def.id}
              className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <p className="text-sm font-medium">{tJobs(`${card.def.id}.name`)}</p>
              <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-300">
                {tJobs(`${card.def.id}.description`)}
              </p>
              <p className="mt-1 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                {card.def.event}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Recent activity ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">{t("activityHeading")}</h2>
        {panel.recentRuns.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            {t("activityEmpty")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("colAutomation")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("colStarted")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("colStatus")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("colResult")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {panel.recentRuns.map((run) => (
                  <tr key={run.id}>
                    <td className="px-3 py-1.5 font-mono text-[11px]">
                      {run.automationId}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                      {format.dateTime(new Date(run.startedAt), {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusPill status={run.status} t={t} />
                    </td>
                    <td className="px-3 py-1.5 text-zinc-600 dark:text-zinc-300">
                      <span className="line-clamp-2 break-all">
                        {run.error ?? summarize(run.summary)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"automations">>>;
type Fmt = Awaited<ReturnType<typeof getFormatter>>;

function scheduleLine(card: AutomationCard, t: T): string {
  if (!card.def.cron) return "";
  if (card.localSchedule?.kind === "daily") {
    return t("scheduleDaily", {
      localTime: card.localSchedule.localTime,
      cron: card.def.cron,
    });
  }
  return t("scheduleInterval", { cron: card.def.cron });
}

function RunLine({
  card,
  t,
  format,
}: {
  card: AutomationCard;
  t: T;
  format: Fmt;
}) {
  if (!card.def.tracked) return null;
  if (!card.lastRun) {
    return (
      <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
        {t("neverRun")}
      </p>
    );
  }
  return (
    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
      <StatusPill status={card.lastRun.status} t={t} />
      {t("lastRan", {
        when: format.relativeTime(new Date(card.lastRun.startedAt), {
          now: new Date(),
        }),
      })}
      {card.failures24h > 0 ? (
        <span className="text-red-600 dark:text-red-400">
          {t("failures24h", { count: card.failures24h })}
        </span>
      ) : null}
    </p>
  );
}

function StatusPill({ status, t }: { status: string; t: T }) {
  const tone =
    status === "ok"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      : status === "error"
        ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
        : status === "skipped"
          ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
          : "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300";
  const Icon =
    status === "ok"
      ? CircleCheck
      : status === "error"
        ? CircleAlert
        : status === "skipped"
          ? CircleSlash
          : Clock;
  const label =
    status === "ok"
      ? t("statusOk")
      : status === "error"
        ? t("statusError")
        : status === "skipped"
          ? t("statusSkipped")
          : t("statusRunning");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-px text-[10px] font-medium",
        tone,
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {label}
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
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

function renderValue(value: unknown, t: T): string {
  if (value === null || value === undefined) return t("valueDefault");
  if (typeof value === "boolean") return value ? t("on") : t("off");
  if (Array.isArray(value)) {
    return value.length === 0 ? t("valueNone") : value.join(", ");
  }
  return String(value);
}
