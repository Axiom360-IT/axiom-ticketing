import "server-only";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ticketParticipants } from "@/lib/db/schema/ticket-participants";
import { tickets } from "@/lib/db/schema/tickets";
import { verifyGuestToken } from "@/lib/tokens";

// ── Who is behind a guest link ────────────────────────────────────────
//
// A guest link is an HMAC token minted for ONE address. Before participants
// existed, holding a valid token for a ticket meant exactly one thing: you're
// the requester. Now an approved participant gets their own token too, so the
// token proves WHICH address you are, and this decides what that address may
// do on that ticket.
//
// Two distinct answers, and the difference matters:
//   - `isCreator` — raised the ticket. Manages the participant list.
//   - otherwise   — an active participant. Reads the thread, replies,
//                   attaches; never touches the participant list.
//
// Creator is anchored to `created_by_email`, never `customer_email`:
// setTicketCustomer can rewrite the latter, which would hand the creator's
// rights to whoever it was pointed at.

export type GuestActor = {
  ticketId: string;
  ticketNumber: string;
  status: string;
  /** The address the token was minted for, lower-cased. */
  email: string;
  /** Display name for their messages — the participant's own name where we
   *  have one, never the requester's. */
  name: string | null;
  isCreator: boolean;
};

/**
 * Resolve and authorize a guest token against a ticket. Returns null for a
 * bad token, an unknown/draft ticket, or an address that is neither the
 * creator nor an active participant — callers must render ONE indistinguishable
 * message for all of those, or the difference becomes an oracle.
 */
export async function resolveGuestActor(
  ticketNumber: string,
  token: string,
): Promise<GuestActor | null> {
  const verifiedEmail = verifyGuestToken(token, ticketNumber);
  if (!verifiedEmail) return null;
  const email = verifiedEmail.toLowerCase();

  const [ticket] = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      status: tickets.status,
      customerEmail: tickets.customerEmail,
      customerName: tickets.customerName,
      createdByEmail: tickets.createdByEmail,
    })
    .from(tickets)
    .where(
      and(
        eq(tickets.ticketNumber, ticketNumber),
        // A draft isn't a ticket yet — the guard the old email-scoped lookup had.
        ne(tickets.status, "draft"),
        // A deleted ticket is gone for guests too. Tokens never expire, so
        // this predicate is the only thing that takes a guest link out of
        // service — and it covers read, reply and attachment download at once,
        // since all three resolve through here.
        isNull(tickets.deletedAt),
      ),
    )
    .limit(1);
  if (!ticket) return null;

  // The requester. `customerEmail` is accepted alongside `createdByEmail` so
  // links minted before that column existed keep working.
  if (
    email === ticket.customerEmail.toLowerCase() ||
    email === ticket.createdByEmail?.toLowerCase()
  ) {
    return {
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      status: ticket.status,
      email,
      name: ticket.customerName,
      isCreator: email === (ticket.createdByEmail?.toLowerCase() ?? email),
    };
  }

  // An approved participant. Pending and removed rows are not active and get
  // nothing — that is the entire point of the approval step.
  const [participant] = await db
    .select({
      name: ticketParticipants.name,
    })
    .from(ticketParticipants)
    .where(
      and(
        eq(ticketParticipants.ticketId, ticket.id),
        eq(ticketParticipants.email, email),
        eq(ticketParticipants.status, "active"),
      ),
    )
    .limit(1);
  if (!participant) return null;

  return {
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumber,
    status: ticket.status,
    email,
    name: participant.name,
    isCreator: false,
  };
}
