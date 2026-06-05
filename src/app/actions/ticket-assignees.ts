"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { requireSessionUser } from "@/lib/auth/session";
import { db, transactional } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { ticketAssignees } from "@/lib/db/schema/ticket-assignees";
import { tickets } from "@/lib/db/schema/tickets";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { loadTicketScope } from "@/lib/tickets/load";

export type CollaboratorResult = { ok: true } | { ok: false; error: string };

// ── Merged-ticket co-assignees (req 4.4/4.5) ──────────────────────────
//
// Every ticket has ONE primary technician (tickets.assigned_to_id), assigned
// via assignTicket. The ONLY way a ticket gains a second technician is a merge:
// mergeTickets records the source ticket's tech here as a co-assignee. The
// Superadmin can then remove either technician — removing the primary promotes
// the co-assignee to sole owner (req 4.5). There is no general "add a
// collaborator to any ticket" action — that violated the single-technician
// rule (req 3.1) and was removed.
// ──────────────────────────────────────────────────────────────────────

/**
 * Remove a technician from a MERGED ticket (req 4.5). Superadmin-only
 * (tickets.merge). Removing a co-assignee leaves the primary solely
 * responsible; removing the primary promotes a co-assignee to sole primary.
 * The removed technician's work-log entries are never touched — they stay
 * preserved and (per the frozen-history rule) read-only (req 4.6).
 */
export async function removeMergedTechnician(
  ticketId: string,
  userId: string,
): Promise<CollaboratorResult> {
  const user = await requireSessionUser();
  const ticket = await loadTicketScope(ticketId);
  if (!ticket) throw new NotFoundError();
  if (
    !(await can(
      user,
      "tickets.merge",
      { type: "ticket", ticket },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  const coAssignees = await db
    .select({ userId: ticketAssignees.userId, isActive: users.isActive })
    .from(ticketAssignees)
    .innerJoin(users, eq(users.id, ticketAssignees.userId))
    .where(eq(ticketAssignees.ticketId, ticket.id));

  // This control exists only for merged tickets (a primary PLUS at least one
  // merge co-assignee). Refuse to strip a single-tech ticket down to none —
  // reassign it instead.
  if (coAssignees.length === 0) {
    return {
      ok: false,
      error: "This ticket has a single technician — reassign it instead.",
    };
  }

  const isPrimary = ticket.assignedToId === userId;
  const isCoAssignee = coAssignees.some((c) => c.userId === userId);
  if (!isPrimary && !isCoAssignee) {
    return { ok: false, error: "That technician isn't assigned to this ticket." };
  }

  // When removing the PRIMARY, work out who to promote BEFORE the transaction:
  // an ACTIVE co-assignee (excluding the one being removed). Never promote a
  // deactivated user — assignTicket forbids assigning to one.
  let promotedTechId: string | null = null;
  if (isPrimary) {
    const promote = coAssignees.find(
      (c) => c.userId !== userId && c.isActive,
    )?.userId;
    if (!promote) {
      return {
        ok: false,
        error:
          "The remaining technician is deactivated — reassign the ticket to an active technician instead.",
      };
    }
    promotedTechId = promote;
  }

  await transactional(async (tx) => {
    if (promotedTechId) {
      await tx
        .update(tickets)
        .set({
          assignedToId: promotedTechId,
          assignedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tickets.id, ticket.id));
      await tx
        .delete(ticketAssignees)
        .where(
          and(
            eq(ticketAssignees.ticketId, ticket.id),
            eq(ticketAssignees.userId, promotedTechId),
          ),
        );
    } else {
      // Remove the co-assignee row; the primary becomes solely responsible.
      await tx
        .delete(ticketAssignees)
        .where(
          and(
            eq(ticketAssignees.ticketId, ticket.id),
            eq(ticketAssignees.userId, userId),
          ),
        );
    }
  });

  await audit({
    actorId: user.id,
    action: "ticket.remove_collaborator",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    before: { removedTechId: userId },
    after: { promotedTechId },
  });

  revalidatePath("/admin/tickets");
  revalidatePath(`/admin/tickets/${ticketId}`);
  return { ok: true };
}

/** Co-assignee technicians on a (merged) ticket — excludes the primary. */
export async function listTicketCollaborators(ticketId: string) {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(ticketAssignees)
    .innerJoin(users, eq(ticketAssignees.userId, users.id))
    .where(eq(ticketAssignees.ticketId, ticketId))
    .orderBy(users.name);
}
