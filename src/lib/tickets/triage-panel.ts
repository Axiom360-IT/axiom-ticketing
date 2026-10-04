import { and, count, eq, isNull } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/can";
import { ticketsVisibilityCondition } from "@/lib/auth/scope";
import { db } from "@/lib/db/client";
import { messages } from "@/lib/db/schema/messages";
import { ticketParticipants } from "@/lib/db/schema/ticket-participants";
import { tickets } from "@/lib/db/schema/tickets";

// ── Coordinator triage panel — chores that silently block work ────────────
//
// Two things stall quietly and appear on no other dashboard surface:
//   • Held customer replies — inbound email whose sender domain doesn't match
//     the ticket's org is stored moderation_status='held' and hidden from the
//     conversation until a coordinator approves it (req 5.2). A real customer
//     is being silently ignored until someone clears it.
//   • People waiting to join a thread — a guest proposed an address, or an
//     inbound email carried one we can't place, so it sits
//     status='pending' and receives nothing until a coordinator decides.
//   • Unverified organizations — a ticket whose submitter typed a company that
//     matched no registered org (org_match_status='unverified'). It never
//     deducts from a Monthly-Plan balance, so it's a quiet billing leak until a
//     coordinator reconciles it.
//
// Each count mirrors the WHERE clause of its destination page's query so the
// dashboard number matches what the user lands on:
//   • held       → listHeldMessages()          (/admin/moderation, tickets.update)
//   • pending    → listPendingParticipants()   (/admin/moderation, tickets.update)
//   • unverified → countUnverifiedOrgTickets()  (/admin/org-triage, organizations.update)
// A count is only computed when the caller holds the matching permission; the
// other comes back null and its tile is hidden.

export type TriagePanel = {
  held: number | null;
  pendingParticipants: number | null;
  unverified: number | null;
};

export async function loadTriagePanel(
  user: SessionUser,
  canModerate: boolean,
  canTriageOrgs: boolean,
): Promise<TriagePanel> {
  const [heldRows, pendingRows, unverifiedRows] = await Promise.all([
    canModerate
      ? db
          .select({ value: count() })
          .from(messages)
          .innerJoin(tickets, eq(messages.ticketId, tickets.id))
          .where(
            and(
              eq(messages.moderationStatus, "held"),
              ticketsVisibilityCondition(user),
            ),
          )
      : Promise.resolve(null),
    // Mirrors listPendingParticipants' WHERE exactly, per the note above.
    canModerate
      ? db
          .select({ value: count() })
          .from(ticketParticipants)
          .innerJoin(tickets, eq(tickets.id, ticketParticipants.ticketId))
          .where(
            and(
              eq(ticketParticipants.status, "pending"),
              ticketsVisibilityCondition(user),
            ),
          )
      : Promise.resolve(null),
    canTriageOrgs
      ? db
          .select({ value: count() })
          .from(tickets)
          .where(
            and(
              eq(tickets.orgMatchStatus, "unverified"),
              isNull(tickets.deletedAt),
            ),
          )
      : Promise.resolve(null),
  ]);

  return {
    held: heldRows ? Number(heldRows[0]?.value ?? 0) : null,
    pendingParticipants: pendingRows
      ? Number(pendingRows[0]?.value ?? 0)
      : null,
    unverified: unverifiedRows ? Number(unverifiedRows[0]?.value ?? 0) : null,
  };
}
