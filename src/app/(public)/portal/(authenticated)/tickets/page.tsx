import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CustomerTicketList } from "@/components/customer/customer-ticket-list";
import { requireSessionUser } from "@/lib/auth/session";
import { listMyTickets } from "@/lib/customer/queries";

export default async function PortalTicketsPage() {
  const user = await requireSessionUser();
  const items = await listMyTickets(user.id);
  const t = await getTranslations("portal.tickets.list");

  return (
    <section className="max-w-3xl mx-auto py-6 sm:py-10 px-4">
      {/* Stack on mobile so the title doesn't share its row with a button.
          Button gets full-width on mobile + 44px height for thumbs. */}
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

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-12 text-center">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("empty")}
          </p>
          <Link
            href="/portal/tickets/new"
            className="mt-4 inline-block text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            {t("createFirst")}
          </Link>
        </div>
      ) : (
        <CustomerTicketList items={items} />
      )}
    </section>
  );
}
