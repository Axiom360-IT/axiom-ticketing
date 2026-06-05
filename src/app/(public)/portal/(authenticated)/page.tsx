import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { CheckCircle2, Clock, FileText, Plus } from "lucide-react";
import { requireSessionUser } from "@/lib/auth/session";
import { listMyTickets } from "@/lib/customer/queries";
import { cn } from "@/lib/utils";

// Customer dashboard at `/portal`. Acts as the default landing after
// sign-in: top-of-funnel stats (counts by status) + the five most recently
// updated tickets + a prominent "+ New ticket" CTA. The full ticket list
// stays at `/portal/tickets`.

export async function generateMetadata() {
  const t = await getTranslations("portal.home");
  return { title: t("metaTitle") };
}

export default async function PortalHomePage() {
  const user = await requireSessionUser();
  const tickets = await listMyTickets(user.id);
  const t = await getTranslations("portal.home");
  const tStatus = await getTranslations("tickets.status");
  const formatter = await getFormatter();

  const counts = {
    open: tickets.filter((row) => row.status === "open").length,
    inProgress: tickets.filter((row) => row.status === "in_progress").length,
    resolved: tickets.filter(
      (row) => row.status === "resolved" || row.status === "closed",
    ).length,
  };
  const recent = tickets.slice(0, 5);

  return (
    <section className="max-w-5xl mx-auto py-6 sm:py-10 px-4 space-y-8">
      {/* Header + primary CTA */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 sm:text-2xl">
            {t("title", { name: user.id.slice(0, 0) || "" })}
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {t("subtitle")}
          </p>
        </div>
        <Link
          href="/portal/tickets/new"
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium min-h-[44px]"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          {t("newTicket")}
        </Link>
      </div>

      {/* Stat grid */}
      <div
        aria-label={t("statsLabel")}
        className="grid grid-cols-1 sm:grid-cols-3 gap-3"
      >
        <StatCard
          label={t("statOpen")}
          value={counts.open}
          icon={FileText}
          accent="blue"
          href="/portal/tickets?status=open"
        />
        <StatCard
          label={t("statInProgress")}
          value={counts.inProgress}
          icon={Clock}
          accent="amber"
          href="/portal/tickets?status=in_progress"
        />
        <StatCard
          label={t("statResolved")}
          value={counts.resolved}
          icon={CheckCircle2}
          accent="green"
          href="/portal/tickets?status=resolved,closed"
        />
      </div>

      {/* Recent tickets */}
      <section aria-labelledby="recent-tickets-heading">
        <div className="flex items-baseline justify-between mb-3">
          <h2
            id="recent-tickets-heading"
            className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
          >
            {t("recentTitle")}
          </h2>
          {tickets.length > 0 ? (
            <Link
              href="/portal/tickets"
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              {t("viewAll")}
            </Link>
          ) : null}
        </div>

        {recent.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-10 text-center">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {t("empty")}
            </p>
            <Link
              href="/portal/tickets/new"
              className="mt-4 inline-block text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              {t("createFirst")}
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {recent.map((ticket) => (
              <li key={ticket.id}>
                <Link
                  href={`/portal/tickets/${ticket.ticketNumber}`}
                  className="block rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                        {ticket.ticketNumber}
                      </p>
                      <p className="mt-0.5 text-sm font-medium text-zinc-900 dark:text-zinc-50 truncate">
                        {ticket.subject}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <StatusPill status={ticket.status} label={tStatus(ticket.status)} />
                      <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        {formatter.relativeTime(ticket.updatedAt, { now: new Date() })}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
  href,
}: {
  label: string;
  value: number;
  icon: typeof FileText;
  accent: "blue" | "amber" | "green";
  href: string;
}) {
  const accentClasses = {
    blue: "text-blue-700 bg-blue-50 dark:text-blue-300 dark:bg-blue-950/40",
    amber: "text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40",
    green: "text-green-700 bg-green-50 dark:text-green-300 dark:bg-green-950/40",
  } as const;
  return (
    <Link
      href={href}
      className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {label}
        </p>
        <span
          className={cn(
            "inline-flex w-7 h-7 items-center justify-center rounded-md",
            accentClasses[accent],
          )}
        >
          <Icon className="w-3.5 h-3.5" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-1.5 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        {value}
      </p>
    </Link>
  );
}

function StatusPill({ status, label }: { status: string; label: string }) {
  // Mirror the design system status tokens — keep names short, colors
  // semantic. Inlined here rather than reaching for the shared badge so
  // we don't need to import a client component into this RSC.
  const styles =
    status === "open"
      ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900"
      : status === "in_progress"
        ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900"
        : status === "resolved"
          ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900"
          : "bg-zinc-50 text-zinc-700 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-700";
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border",
        styles,
      )}
    >
      {label}
    </span>
  );
}
