import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { rolePermissions, roles, userRoles } from "@/lib/db/schema/rbac";
import { ticketAssignees } from "@/lib/db/schema/ticket-assignees";
import { tickets } from "@/lib/db/schema/tickets";

/**
 * Load the canonical ticket scope used by both ticket actions and attachment
 * actions for permission checks, audit context, and notification fan-out.
 * Returns the superset of fields needed by all current callers; consumers
 * pick what they need.
 */
export async function loadTicketScope(ticketId: string) {
  const [t] = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      assignedToId: tickets.assignedToId,
      customerId: tickets.customerId,
      customerEmail: tickets.customerEmail,
      customerName: tickets.customerName,
      organizationId: tickets.organizationId,
      status: tickets.status,
      isEscalated: tickets.isEscalated,
      priority: tickets.priority,
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

  return { ...t, assigneeIds: collaborators.map((c) => c.userId) };
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
