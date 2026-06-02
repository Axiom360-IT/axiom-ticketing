"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { can, isStrictTechnician } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { requireSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { ticketAssignees } from "@/lib/db/schema/ticket-assignees";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { loadTicketScope } from "@/lib/tickets/load";

export type CollaboratorResult = { ok: true } | { ok: false; error: string };

// Multi-technician assignment (Meeting-2, CR-11). Adding/removing collaborating
// technicians is for elevated roles (admin / coordinator); a plain technician
// does single reassignment via `assignTicket`. Gate: tickets.assign + NOT a
// strict technician.
async function requireElevatedAssigner(ticketId: string) {
  const user = await requireSessionUser();
  const ticket = await loadTicketScope(ticketId);
  if (!ticket) throw new NotFoundError();
  if (
    !(await can(
      user,
      "tickets.assign",
      { type: "ticket", ticket },
      productionContext,
    )) ||
    isStrictTechnician(user)
  ) {
    throw new ForbiddenError();
  }
  return { user, ticket };
}

export async function addTicketCollaborator(
  ticketId: string,
  userId: string,
): Promise<CollaboratorResult> {
  const { user, ticket } = await requireElevatedAssigner(ticketId);

  if (userId === ticket.assignedToId) {
    return { ok: false, error: "That technician is already the primary assignee." };
  }
  const [target] = await db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) throw new NotFoundError();
  if (!target.isActive) {
    return { ok: false, error: "Cannot assign a deactivated user." };
  }

  await db
    .insert(ticketAssignees)
    .values({ ticketId, userId, assignedById: user.id })
    .onConflictDoNothing();

  await audit({
    actorId: user.id,
    action: "ticket.add_collaborator",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    after: { collaboratorId: userId },
  });

  revalidatePath(`/admin/tickets/${ticketId}`);
  return { ok: true };
}

export async function removeTicketCollaborator(
  ticketId: string,
  userId: string,
): Promise<CollaboratorResult> {
  const { user, ticket } = await requireElevatedAssigner(ticketId);

  await db
    .delete(ticketAssignees)
    .where(
      and(
        eq(ticketAssignees.ticketId, ticketId),
        eq(ticketAssignees.userId, userId),
      ),
    );

  await audit({
    actorId: user.id,
    action: "ticket.remove_collaborator",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    before: { collaboratorId: userId },
  });

  revalidatePath(`/admin/tickets/${ticketId}`);
  return { ok: true };
}

/** Collaborating technicians on a ticket (excludes the primary assignee). */
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
