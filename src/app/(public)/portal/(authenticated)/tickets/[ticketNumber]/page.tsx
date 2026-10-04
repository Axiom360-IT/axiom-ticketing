import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CustomerCsatPrompt } from "@/components/customer/customer-csat-prompt";
import { CustomerMessageThread } from "@/components/customer/customer-message-thread";
import { ParticipantsPanel } from "@/components/tickets/participants-panel";
import { listTicketParticipantsForPanel } from "@/lib/tickets/participants";
import { CustomerReplyComposer } from "@/components/customer/customer-reply-composer";
import { CustomerTicketHeader } from "@/components/customer/customer-ticket-header";
import { requireSessionUser } from "@/lib/auth/session";
import {
  getMyMessageThread,
  getMyTicketByNumber,
} from "@/lib/customer/queries";
import { getAttachmentLimits } from "@/lib/storage/limits";

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

  const participantRows = await listTicketParticipantsForPanel(
    ticket.id,
    "customer",
  );
  const tParticipants = await getTranslations("tickets.participants");

  const [messages, limits] = await Promise.all([
    getMyMessageThread(ticket.id),
    getAttachmentLimits(),
  ]);
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

      {/* Say whose ticket this is, so a colleague isn't confused about why
          they can read it but not change it. */}
      {ticket.sharedWithMe ? (
        <p className="mb-4 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 px-3 py-2 text-sm text-blue-900 dark:text-blue-200">
          {t("sharedWithYou", { name: ticket.customerName })}
        </p>
      ) : null}

      {/* Initial description as the first thread item */}
      <div className="mb-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <p className="text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap break-words">
          {ticket.description}
        </p>
      </div>

      <div className="mb-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <h2 className="mb-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {tParticipants("title")}
        </h2>
        <ParticipantsPanel
          mode="portal"
          ticketId={ticket.id}
          // The requester decides who else is on their ticket. A colleague
          // who was added to it reads and replies, nothing more.
          canManage={!ticket.sharedWithMe}
          requester={{
            email: ticket.customerEmail,
            name: ticket.customerName,
          }}
          rows={participantRows}
        />
      </div>

      {messages.length > 0 ? (
        <CustomerMessageThread messages={messages} />
      ) : null}

      {/* CSAT prompt — shown when the ticket is resolved AND the customer
          hasn't rated it yet. After they pick an emoji the action revalidates
          and the prompt either becomes a recap banner (csatRating now set) or
          the ticket reopens. */}
      {/* Not for participants: rating the service is the requester's call, and
          the CSAT action is owner-scoped anyway — showing it to a colleague
          would offer a button that always fails. */}
      {!ticket.sharedWithMe &&
      (ticket.status === "resolved" || ticket.csatRating || ticket.csatResponse) ? (
        <CustomerCsatPrompt ticketId={ticket.id} csatRating={ticket.csatRating} />
      ) : null}

      {ticket.status === "closed" ? (
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400 italic">
          {t("closedNotice")}
        </p>
      ) : (
        <CustomerReplyComposer
          ticketId={ticket.id}
          maxFiles={limits.maxFilesPerMessage}
          maxFileBytes={limits.maxFileBytes}
        />
      )}
    </article>
  );
}
