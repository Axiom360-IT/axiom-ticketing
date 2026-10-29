import Link from "next/link";
import type { getFormatter, getTranslations } from "next-intl/server";
import {
  CircleAlert,
  CircleCheck,
  CircleMinus,
  ChevronLeft,
  ChevronRight,
  Clock,
  Zap,
} from "lucide-react";
import type { AutomationCard } from "@/lib/automations/panel";
import type { AutomationRunRow } from "@/lib/automations/runs";
import { cn } from "@/lib/utils";
import { AutomationToggle } from "./automation-toggle";

// Server-rendered building blocks for the Automations page: the compact job
// row, a run's status chip, the history list and its pager. Translators and the
// formatter are passed in rather than re-fetched so a page that renders thirty
// rows does not ask for them thirty times.

export type T = Awaited<ReturnType<typeof getTranslations<"automations">>>;
export type TJobs = Awaited<ReturnType<typeof getTranslations<"automations.jobs">>>;
export type Fmt = Awaited<ReturnType<typeof getFormatter>>;

export function scheduleText(card: AutomationCard, t: T): string {
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

export function RunStatusChip({ status, t }: { status: string; t: T }) {
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
export function summarize(summary: unknown): string {
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

// ── One automation, as a compact row ──────────────────────────────────

export function JobRow({
  card,
  href,
  selected,
  canToggle,
  t,
  tJobs,
  format,
}: {
  card: AutomationCard;
  /** Where clicking the row goes: the same page with this job's pane open. */
  href: string;
  selected: boolean;
  canToggle: boolean;
  t: T;
  tJobs: TJobs;
  format: Fmt;
}) {
  const off = card.enabledKey !== null && !card.enabled;
  const broken = card.failures24h > 0;
  const isScheduled = card.def.kind === "scheduled";

  return (
    <div
      className={cn(
        // A coloured left edge so a failing or paused job is findable without
        // reading every row.
        "group flex items-stretch rounded-lg border border-l-4 bg-white transition-colors dark:bg-zinc-900",
        selected && "ring-2 ring-blue-500/60",
        !isScheduled
          ? "border-zinc-200 border-l-violet-400 dark:border-zinc-800"
          : broken
            ? "border-zinc-200 border-l-red-500 dark:border-zinc-800"
            : off
              ? "border-zinc-200 border-l-zinc-300 dark:border-zinc-800 dark:border-l-zinc-600"
              : "border-zinc-200 border-l-emerald-500 dark:border-zinc-800",
      )}
    >
      {/* The whole left side is the link; the switch sits OUTSIDE it, so
          flipping a switch never also opens the pane. */}
      <Link
        href={href}
        scroll={false}
        className="min-w-0 flex-1 rounded-l-md p-3 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-blue-500 dark:hover:bg-zinc-800/50"
      >
        <p
          className={cn(
            "truncate text-sm font-medium",
            off && "text-zinc-500 dark:text-zinc-400",
          )}
        >
          {tJobs(`${card.def.id}.name`)}
        </p>
        <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500 dark:text-zinc-400">
          {tJobs(`${card.def.id}.description`)}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {isScheduled ? (
            <span className="inline-flex items-center gap-1 rounded bg-zinc-50 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
              <Clock className="size-3 opacity-60" aria-hidden="true" />
              {scheduleText(card, t)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
              <Zap className="size-3" aria-hidden="true" />
              {t("triggeredBy")}
            </span>
          )}

          {isScheduled && card.def.tracked ? (
            card.lastRun ? (
              <span className="inline-flex items-center gap-1.5">
                <RunStatusChip status={card.lastRun.status} t={t} />
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {format.relativeTime(new Date(card.lastRun.startedAt), {
                    now: new Date(),
                  })}
                </span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                <CircleMinus className="size-3" aria-hidden="true" />
                {t("neverRun")}
              </span>
            )
          ) : null}

          {broken ? (
            <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300">
              <CircleAlert className="size-3" aria-hidden="true" />
              {t("failures24h", { count: card.failures24h })}
            </span>
          ) : null}
        </div>
      </Link>

      {isScheduled ? (
        <div className="flex shrink-0 items-center border-l border-zinc-100 px-3 dark:border-zinc-800">
          {card.enabledKey && canToggle ? (
            <AutomationToggle
              settingKey={card.enabledKey}
              enabled={card.enabled}
              label={tJobs(`${card.def.id}.name`)}
            />
          ) : (
            <span className="inline-flex items-center rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              {card.enabledKey ? t("readOnly") : t("alwaysOn")}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── Run history ───────────────────────────────────────────────────────

function duration(run: AutomationRunRow): string | null {
  if (!run.finishedAt) return null;
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function RunList({
  runs,
  t,
  format,
  nameFor,
  hrefFor,
}: {
  runs: AutomationRunRow[];
  t: T;
  format: Fmt;
  /** Shown per row on the all-automations Activity tab; omitted in a single
   *  automation's pane, where every row is the same job. */
  nameFor?: (run: AutomationRunRow) => string;
  /** Makes the name a link that opens that automation's pane. */
  hrefFor?: (run: AutomationRunRow) => string | null;
}) {
  return (
    <ul className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
      {runs.map((run) => {
        const started = new Date(run.startedAt);
        const took = duration(run);
        const name = nameFor?.(run);
        const href = hrefFor?.(run);
        return (
          <li key={run.id} className="px-3 py-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <RunStatusChip status={run.status} t={t} />
              {name ? (
                href ? (
                  <Link
                    href={href}
                    scroll={false}
                    className="min-w-0 flex-1 truncate text-[13px] font-medium text-blue-700 hover:underline dark:text-blue-400"
                  >
                    {name}
                  </Link>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {name}
                  </span>
                )
              ) : null}
              <span
                className="ml-auto shrink-0 text-zinc-500 dark:text-zinc-400"
                title={format.dateTime(started, {
                  dateStyle: "medium",
                  timeStyle: "medium",
                })}
              >
                {format.relativeTime(started, { now: new Date() })}
                {took ? ` · ${took}` : ""}
              </span>
            </div>
            {run.error ? (
              // A stack trace is long; keep the row scannable and let the
              // person who wants it open it.
              <details className="mt-1.5">
                <summary className="cursor-pointer text-red-700 dark:text-red-400">
                  {run.error.split("\n")[0]?.slice(0, 140)}
                </summary>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-red-50 p-2 text-[11px] text-red-800 dark:bg-red-950/40 dark:text-red-300">
                  {run.error}
                </pre>
              </details>
            ) : (
              <p className="mt-1 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                {summarize(run.summary)}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A compact pager for places the shared <Pagination> does not fit — here the
 * side pane, whose page counter (`hpage`) must not collide with the page's own.
 */
export function SimplePager({
  page,
  pageSize,
  total,
  hrefFor,
  t,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
  t: (k: "newer" | "older" | "range", v?: Record<string, number>) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(page, 1), pages);
  const start = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const end = Math.min(current * pageSize, total);
  const btn =
    "inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs transition-colors";

  return (
    <nav className="flex items-center justify-between gap-3" aria-label="History pages">
      <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
        {t("range", { start, end, total })}
      </span>
      <div className="flex gap-1.5">
        {current > 1 ? (
          <Link
            href={hrefFor(current - 1)}
            scroll={false}
            className={cn(btn, "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800")}
          >
            <ChevronLeft className="size-3.5" aria-hidden="true" />
            {t("newer")}
          </Link>
        ) : null}
        {current < pages ? (
          <Link
            href={hrefFor(current + 1)}
            scroll={false}
            className={cn(btn, "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800")}
          >
            {t("older")}
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
