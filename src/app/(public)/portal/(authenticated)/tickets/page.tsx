import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CustomerTicketList } from "@/components/customer/customer-ticket-list";
import { requireSessionUser } from "@/lib/auth/session";
import { listMyTickets } from "@/lib/customer/queries";
import { cn } from "@/lib/utils";

type SearchParams = Promise<{ status?: string; q?: string }>;

// Quick-filter chip set. Each chip is just a link with a `?status=`
// query param — no client state. The "All" chip clears the filter by
// sending no status param. Multi-value via comma is supported (the
// dashboard's "Resolved" stat links here with `status=resolved,closed`
// to show both terminal statuses together).
const STATUS_CHIPS = [
  { key: "all", value: "" },
  { key: "open", value: "open" },
  { key: "in_progress", value: "in_progress" },
  { key: "resolved", value: "resolved,closed" },
] as const;

export default async function PortalTicketsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requireSessionUser();
  const sp = await searchParams;
  const items = await listMyTickets(user.id);
  const t = await getTranslations("portal.tickets.list");
  const tStatus = await getTranslations("tickets.status");

  // Apply status + search filters in memory. The full list is bounded
  // by how many tickets a single customer files — far below the
  // threshold where pushing the filter into SQL would matter.
  const activeStatuses = sp.status
    ? new Set(
        sp.status
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : null;
  const q = (sp.q ?? "").trim().toLowerCase();
  const filtered = items.filter((row) => {
    if (activeStatuses && !activeStatuses.has(row.status)) return false;
    if (q) {
      const haystack = `${row.ticketNumber} ${row.subject}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  return (
    <section className="max-w-5xl mx-auto py-6 sm:py-10 px-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            {t("title")}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("subtitle")}
          </p>
        </div>
        <Link
          href="/portal/tickets/new"
          className="inline-flex items-center justify-center px-4 py-2.5 sm:py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium min-h-[44px] sm:min-h-0"
        >
          {t("newTicket")}
        </Link>
      </div>

      {/* Filter row: status chips + search input. Both are pure
          links / GET form so the URL carries the state — bookmarkable,
          no client JS needed. */}
      <div className="mb-5 flex flex-col sm:flex-row sm:items-center gap-3">
        <div
          role="tablist"
          aria-label={t("filterStatusLabel")}
          className="flex flex-wrap gap-1.5"
        >
          {STATUS_CHIPS.map((chip) => {
            const isActive =
              chip.value === "" ? !sp.status : sp.status === chip.value;
            const href = chip.value
              ? `/portal/tickets?status=${encodeURIComponent(chip.value)}${q ? `&q=${encodeURIComponent(q)}` : ""}`
              : q
                ? `/portal/tickets?q=${encodeURIComponent(q)}`
                : "/portal/tickets";
            const label =
              chip.key === "all" ? t("filterAll") : tStatus(chip.key);
            return (
              <Link
                key={chip.key}
                href={href}
                role="tab"
                aria-selected={isActive}
                className={cn(
                  "inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium border transition-colors min-h-[36px]",
                  isActive
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800",
                )}
              >
                {label}
              </Link>
            );
          })}
        </div>
        <form
          action="/portal/tickets"
          method="get"
          className="sm:ml-auto flex items-center gap-2"
        >
          {/* Carry the active status forward so submitting search
              doesn't reset the chip selection. */}
          {sp.status ? (
            <input type="hidden" name="status" value={sp.status} />
          ) : null}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder={t("searchPlaceholder")}
            className="w-full sm:w-64 px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label={t("searchPlaceholder")}
          />
        </form>
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-12 text-center">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {items.length === 0 ? t("empty") : t("emptyFiltered")}
          </p>
          {items.length === 0 ? (
            <Link
              href="/portal/tickets/new"
              className="mt-4 inline-block text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              {t("createFirst")}
            </Link>
          ) : (
            <Link
              href="/portal/tickets"
              className="mt-4 inline-block text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              {t("clearFilters")}
            </Link>
          )}
        </div>
      ) : (
        <CustomerTicketList items={filtered} />
      )}
    </section>
  );
}
