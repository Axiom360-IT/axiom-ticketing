import { and, count, eq, isNull } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/can";
import { ticketsVisibilityCondition } from "@/lib/auth/scope";
import { db } from "@/lib/db/client";
import { messages } from "@/lib/db/schema/messages";
import { tickets } from "@/lib/db/schema/tickets";

// ── Coordinator triage panel — chores that silently block work ────────────
//
// Two things stall quietly and appear on no other dashboard surface:
//   • Held customer replies — inbound email whose sender domain doesn't match
//     the ticket's org is stored moderation_status='held' and hidden from the
//     conversation until a coordinator approves it (req 5.2). A real customer
//     is being silently ignored until someone clears it.
//   • Unverified organizations — a ticket whose submitter typed a company that
//     matched no registered org (org_match_status='unverified'). It never
//     deducts from a Monthly-Plan balance, so it's a quiet billing leak until a
//     coordinator reconciles it.
//
// Each count mirrors the WHERE clause of its destination page's query so the
// dashboard number matches what the user lands on:
//   • held       → listHeldMessages()          (/admin/moderation, tickets.update)
//   • unverified → countUnverifiedOrgTickets()  (/admin/org-triage, organizations.update)
// A count is only computed when the caller holds the matching permission; the
// other comes back null and its tile is hidden.

export type TriagePanel = {
  held: number | null;
  unverified: number | null;
};

export async function loadTriagePanel(
  user: SessionUser,
  canModerate: boolean,
  canTriageOrgs: boolean,
): Promise<TriagePanel> {
  const [heldRows, unverifiedRows] = await Promise.all([
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
    unverified: unverifiedRows ? Number(unverifiedRows[0]?.value ?? 0) : null,
  };
}
