import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CustomerMessageThread } from "@/components/customer/customer-message-thread";
import { CustomerReplyComposer } from "@/components/customer/customer-reply-composer";
import { CustomerTicketHeader } from "@/components/customer/customer-ticket-header";
import { requireSessionUser } from "@/lib/auth/session";
import {
  getMyMessageThread,
  getMyTicketByNumber,
} from "@/lib/customer/queries";

type Params = Promise<{ ticketNumber: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { ticketNumber } = await params;
  const t = await getTranslations("portal.tickets.detail");
  return { title: t("metaTitle", { ticketNumber }) };
}

export default async function PortalTicketDetailPage({
  params,
}: {
  params: Params;
}) {
  const { ticketNumber } = await params;
  const user = await requireSessionUser();
  const ticket = await getMyTicketByNumber(user.id, ticketNumber);
  if (!ticket) notFound();

  const messages = await getMyMessageThread(ticket.id);
  const t = await getTranslations("portal.tickets.detail");

  return (
    <article className="max-w-3xl mx-auto py-10 px-4">
      <Link
        href="/portal/tickets"
        className="text-sm text-blue-600 dark:text-blue-400 hover:underline inline-block mb-4"
      >
        {t("back")}
      </Link>
      <CustomerTicketHeader ticket={ticket} />

      {/* Initial description as the first thread item */}
      <div className="mb-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <p className="text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap break-words">
          {ticket.description}
        </p>
      </div>

      {messages.length > 0 ? (
        <CustomerMessageThread messages={messages} />
      ) : null}

      {ticket.status === "closed" ? (
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400 italic">
          {t("closedNotice")}
        </p>
      ) : (
        <CustomerReplyComposer ticketId={ticket.id} />
      )}
    </article>
  );
}
