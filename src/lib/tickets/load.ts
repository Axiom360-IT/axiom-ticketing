import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { rolePermissions, roles, userRoles } from "@/lib/db/schema/rbac";
import { ticketAssignees } from "@/lib/db/schema/ticket-assignees";
import { ticketParticipants } from "@/lib/db/schema/ticket-participants";
import { tickets } from "@/lib/db/schema/tickets";

/**
 * Load the canonical ticket scope used by both ticket actions and attachment
 * actions for permission checks, audit context, and notification fan-out.
 * Returns the superset of fields needed by all current callers; consumers
 * pick what they need.
 *
 * `viewerUserId` is for the customer-portal callers: pass it and the scope
 * carries `viewerIsParticipant`, which is what lets a colleague added to
 * someone else's ticket read and reply to it while signed in. Staff paths
 * omit it — their access never depends on the participant list.
 */
export async function loadTicketScope(
  ticketId: string,
  viewerUserId?: string,
) {
  const [t] = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      createdById: tickets.createdById,
      assignedToId: tickets.assignedToId,
      customerId: tickets.customerId,
      customerEmail: tickets.customerEmail,
      createdByEmail: tickets.createdByEmail,
      customerName: tickets.customerName,
      organizationId: tickets.organizationId,
      status: tickets.status,
      isEscalated: tickets.isEscalated,
      priority: tickets.priority,
      category: tickets.category,
      type: tickets.type,
      serviceType: tickets.serviceType,
      responseDueAt: tickets.responseDueAt,
      resolutionDueAt: tickets.resolutionDueAt,
      slaPausedAt: tickets.slaPausedAt,
      deletedAt: tickets.deletedAt,
      duplicateOfId: tickets.duplicateOfId,
    })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!t) return t;

  // Additional collaborating technicians (Meeting-2, CR-11). Included so the
  // can() gate grants them ticket access alongside the primary assignee.
  const collaborators = await db
    .select({ userId: ticketAssignees.userId })
    .from(ticketAssignees)
    .where(eq(ticketAssignees.ticketId, ticketId));

  // Participants are keyed by EMAIL, the portal by account — so the join is
  // on the address, lower-cased on both sides because participant rows are
  // always stored lower-case while an account's address is stored as typed.
  let viewerIsParticipant = false;
  if (viewerUserId) {
    const [row] = await db
      .select({ id: ticketParticipants.id })
      .from(ticketParticipants)
      .innerJoin(
        users,
        eq(sql`lower(${users.email})`, ticketParticipants.email),
      )
      .where(
        and(
          eq(ticketParticipants.ticketId, ticketId),
          eq(ticketParticipants.status, "active"),
          eq(users.id, viewerUserId),
        ),
      )
      .limit(1);
    viewerIsParticipant = Boolean(row);
  }

  return {
    ...t,
    assigneeIds: collaborators.map((c) => c.userId),
    viewerIsParticipant,
  };
}

export type AssignableTechnician = {
  id: string;
  name: string;
  email: string;
};

/**
 * Users eligible to be assigned a ticket: anyone whose role grants
 * `tickets.update`. Sorted by name for stable display.
 */
export async function listAssignableTechnicians(): Promise<AssignableTechnician[]> {
  const techRoleRows = await db
    .selectDistinct({ roleId: rolePermissions.roleId })
    .from(rolePermissions)
    .where(eq(rolePermissions.permission, "tickets.update"));
  const techRoleIds = techRoleRows.map((r) => r.roleId);
  if (techRoleIds.length === 0) return [];

  const techRows = await db
    .selectDistinct({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(inArray(roles.id, techRoleIds));

  return techRows.sort((a, b) => a.name.localeCompare(b.name));
}
