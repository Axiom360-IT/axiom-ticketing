import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CustomerMessageThread } from "@/components/customer/customer-message-thread";
import { CustomerTicketHeader } from "@/components/customer/customer-ticket-header";
import { GuestReplyComposer } from "@/components/customer/guest-reply-composer";
import { getGuestTicket, getMyMessageThread } from "@/lib/customer/queries";
import { verifyGuestToken } from "@/lib/tokens";

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

  const verifiedEmail = verifyGuestToken(token, ticketNumber);
  if (!verifiedEmail) notFound();

  const ticket = await getGuestTicket(ticketNumber, verifiedEmail);
  if (!ticket) notFound();

  const messages = await getMyMessageThread(ticket.id);
  const t = await getTranslations("portal.tickets.detail");
  const tGuest = await getTranslations("portal.guest");

  return (
    <article className="max-w-3xl mx-auto py-10 px-4">
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
        {tGuest("viewingAs", { email: verifiedEmail })}
      </p>

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
        <GuestReplyComposer
          ticketId={ticket.id}
          ticketNumber={ticketNumber}
          token={token}
          customerEmail={verifiedEmail}
        />
      )}
    </article>
  );
}
