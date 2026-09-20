import type { tickets } from "@/lib/db/schema/tickets";

// When a CUSTOMER replies, a ticket parked in `awaiting_customer_confirmation`
// is no longer waiting on them — the ball is back with the team. Nothing used
// to move it, so the ticket stayed parked forever: the follow-up monitor skips
// any ticket whose last visible message is the customer's, so it would never be
// reminded again NOR auto-closed, and staff saw "Awaiting customer" on a ticket
// the customer had already answered.
//
// Leaving the status also has to RESUME the SLA clock the same way
// setTicketStatus does on a manual exit from a pause status — shift the due
// dates forward by the paused span and clear the marker. Without that the
// ticket keeps `sla_paused_at` set and is skipped by the SLA monitor for good.

export type AwaitingCustomerTicket = {
  status: string;
  assignedToId: string | null;
  slaPausedAt: Date | null;
  responseDueAt: Date | null;
  resolutionDueAt: Date | null;
};

type TicketPatch = Partial<typeof tickets.$inferInsert>;

/**
 * The column patch that hands a parked ticket back to the team, or null when
 * the ticket isn't parked (every other status is left exactly as it is).
 * Callers merge it into the `updatedAt` touch they already perform.
 */
export function resumeFromAwaitingCustomer(
  ticket: AwaitingCustomerTicket,
  now: Date,
): TicketPatch | null {
  if (ticket.status !== "awaiting_customer_confirmation") return null;

  const patch: TicketPatch = {
    // Mirrors reopenTicket: back to the assignee if it still has one.
    status: ticket.assignedToId ? "in_progress" : "open",
    // A fresh reminder series belongs to the team's NEXT reply, so clear this
    // cycle's stamps rather than leaving a spent counter behind.
    customerFollowupSentAt: null,
    customerFollowupCount: 0,
    slaPausedAt: null,
  };

  const pausedSince = ticket.slaPausedAt;
  if (pausedSince) {
    const delta = now.getTime() - pausedSince.getTime();
    if (delta > 0) {
      if (ticket.responseDueAt) {
        patch.responseDueAt = new Date(ticket.responseDueAt.getTime() + delta);
      }
      if (ticket.resolutionDueAt) {
        patch.resolutionDueAt = new Date(
          ticket.resolutionDueAt.getTime() + delta,
        );
      }
    }
  }
  return patch;
}
