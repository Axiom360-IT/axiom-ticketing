import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CustomerMessageThread } from "@/components/customer/customer-message-thread";
import { ParticipantsPanel } from "@/components/tickets/participants-panel";
import { listTicketParticipantsForPanel } from "@/lib/tickets/participants";
import { CustomerTicketHeader } from "@/components/customer/customer-ticket-header";
import { GuestReplyComposer } from "@/components/customer/guest-reply-composer";
import {
  getGuestTicketById,
  getMyMessageThread,
} from "@/lib/customer/queries";
import { resolveGuestActor } from "@/lib/tickets/guest-actor";
import { getAttachmentLimits } from "@/lib/storage/limits";

type Params = Promise<{ ticketNumber: string }>;
type Search = Promise<{ token?: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { ticketNumber } = await params;
  const t = await getTranslations("portal.tickets.detail");
  return {
    title: t("metaTitle", { ticketNumber }),
    // Guest URLs carry a token in the query string — keep search engines
    // out of them and out of the rendered page.
    robots: { index: false, follow: false },
  };
}

// Token-authenticated guest view of a single ticket. Spec §4.2 / §7.2:
// no login required, link does not expire (HMAC-signed). Defense-in-
// depth: even with a valid signature, the ticket is loaded by number
// AND the email decoded from the token must match `customer_email` on
// the row. Mismatch → 404 (constant-time, identical to "not found"
// per PRD §5.13 #Error Message Hygiene).

export default async function GuestTicketViewPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { ticketNumber } = await params;
  const { token } = await searchParams;
  if (!token) notFound();

  // One authorization for every guest surface: the creator OR an approved
  // participant. A bad token, an unknown ticket and "not on this thread" all
  // 404 identically — telling them apart would be an oracle.
  const actor = await resolveGuestActor(ticketNumber, token);
  if (!actor) notFound();

  const ticket = await getGuestTicketById(actor.ticketId);
  if (!ticket) notFound();

  const participantRows = await listTicketParticipantsForPanel(
    ticket.id,
    "guest",
  );
  const tParticipants = await getTranslations("tickets.participants");

  const [messages, limits] = await Promise.all([
    getMyMessageThread(ticket.id),
    getAttachmentLimits(),
  ]);
  const t = await getTranslations("portal.tickets.detail");
  const tGuest = await getTranslations("portal.guest");

  return (
    <article className="max-w-3xl mx-auto py-10 px-4">
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4 break-words">
        {tGuest("viewingAs", { email: actor.email })}
      </p>

      <CustomerTicketHeader ticket={ticket} />

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
          ticketNumber={ticket.ticketNumber}
          guestToken={token}
          canManage={actor.isCreator}
          requester={{
            email: ticket.customerEmail,
            name: ticket.customerName,
          }}
          rows={participantRows}
        />
      </div>

      {messages.length > 0 ? (
        <CustomerMessageThread
          messages={messages}
          guestToken={token}
          ticketNumber={ticketNumber}
        />
      ) : null}

      {ticket.status === "closed" ? (
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400 italic">
          {t("closedNotice")}
        </p>
      ) : (
        <GuestReplyComposer
          ticketId={ticket.id}
          ticketNumber={ticketNumber}
          token={token}
          customerEmail={actor.email}
          maxFiles={limits.maxFilesPerMessage}
          maxFileBytes={limits.maxFileBytes}
        />
      )}
    </article>
  );
}
