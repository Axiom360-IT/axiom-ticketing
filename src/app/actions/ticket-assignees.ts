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
import { inngest } from "@/inngest/client";
import { getAppUrl } from "@/lib/request";

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
    .select({ id: users.id, name: users.name, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) throw new NotFoundError();
  if (!target.isActive) {
    return { ok: false, error: "Cannot assign a deactivated user." };
  }

  // `returning()` tells us whether a row was actually inserted — an empty
  // result means they were already a collaborator (ON CONFLICT DO NOTHING),
  // so we skip the audit + notification for that no-op re-add.
  const inserted = await db
    .insert(ticketAssignees)
    .values({ ticketId, userId, assignedById: user.id })
    .onConflictDoNothing()
    .returning({ userId: ticketAssignees.userId });

  if (inserted.length === 0) {
    // Already collaborating — idempotent success, nothing changed.
    revalidatePath(`/admin/tickets/${ticketId}`);
    return { ok: true };
  }

  await audit({
    actorId: user.id,
    action: "ticket.add_collaborator",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    after: { collaboratorId: userId },
  });

  // Notify the newly-added collaborator the same way the primary assignee is
  // notified in `assignTicket` — one dispatch event; the dispatcher gates
  // email/SMS by the recipient's notification preferences and always inserts
  // an in-app (bell) notification. Wrapped so a notification failure never
  // rolls back the assignment.
  try {
    const appUrl = getAppUrl();
    const ticketUrl = `${appUrl}/admin/tickets/${ticket.id}`;
    await inngest.send({
      name: "notification/dispatch",
      data: {
        type: "ticket.assigned",
        recipientUserIds: [userId],
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        email: {
          template: {
            template: "new_assignment",
            data: {
              ticketNumber: ticket.ticketNumber,
              technicianName: target.name,
              subject: ticket.subject,
              priority: ticket.priority as
                | "low"
                | "medium"
                | "high"
                | "critical",
              customerName: ticket.customerName,
              ticketUrl,
            },
          },
          ticketNumber: ticket.ticketNumber,
        },
        sms: {
          template: {
            template: "ticket_assigned",
            data: { ticketNumber: ticket.ticketNumber, ticketUrl },
          },
        },
        inApp: {
          titleArgs: { ticketNumber: ticket.ticketNumber },
          bodyArgs: { subject: ticket.subject },
          linkUrl: `/admin/tickets/${ticket.id}`,
        },
      },
    });
  } catch (err) {
    console.error("[addTicketCollaborator] dispatch failed:", err);
  }

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
