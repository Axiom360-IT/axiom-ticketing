import "server-only";
import {
  type SQL,
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema/organizations";
import { roles, userRoles } from "@/lib/db/schema/rbac";
import { attachments } from "@/lib/db/schema/attachments";
import { users } from "@/lib/db/schema/auth";
import { messages } from "@/lib/db/schema/messages";
import { ticketParticipants } from "@/lib/db/schema/ticket-participants";
import { tickets } from "@/lib/db/schema/tickets";
import { customerVisibleMessages } from "@/lib/messages/visibility";

export type CustomerTicketSummary = {
  id: string;
  ticketNumber: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  // The technician handling the ticket (null when not yet assigned), shown to
  // the customer so they know who's on it.
  assignedToName: string | null;
  assignedToEmail: string | null;
  /** True when the viewer is a participant rather than the requester — the
   *  ticket belongs to a colleague and is only shared with them. */
  sharedWithMe: boolean;
};

export type CustomerTicket = {
  id: string;
  ticketNumber: string;
  /** The requester — always the viewer on both customer paths (one is scoped
   *  by customerId, the other by the token's verified email), so this exposes
   *  nothing they don't already know. Shown as the Requester row on the
   *  participants panel. */
  customerEmail: string;
  customerName: string;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
  csatResponse: string | null;
  csatRating: string | null;
  /** True when the viewer reached this ticket as a participant, not as its
   *  requester. Read and reply only — no participant management, no CSAT. */
  sharedWithMe: boolean;
};

export type CustomerAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  scanStatus: string;
};

export type CustomerMessage = {
  id: string;
  authorType: "agent" | "customer" | "system";
  authorName: string;
  body: string;
  bodyFormat: string;
  channel: string;
  createdAt: Date;
  attachments: CustomerAttachment[];
};

/**
 * A ticket the signed-in account can reach: one it owns, OR one a colleague
 * or staff member added their address to as an active participant.
 *
 * Participants are keyed by email and accounts by id, so the two legs join on
 * the address — lower-cased on both sides, since participant rows are stored
 * lower-case while an account's address is stored as typed.
 */
function myTicketsCondition(userId: string): SQL {
  const viewer = db
    .select({ email: sql<string>`lower(${users.email})`.as("email") })
    .from(users)
    .where(eq(users.id, userId));

  return and(
    or(
      eq(tickets.customerId, userId),
      exists(
        db
          .select({ id: ticketParticipants.id })
          .from(ticketParticipants)
          .where(
            and(
              eq(ticketParticipants.ticketId, tickets.id),
              eq(ticketParticipants.status, "active"),
              inArray(ticketParticipants.email, viewer),
            ),
          ),
      ),
    ),
    ne(tickets.status, "draft"),
  )!;
}

/** Lists tickets the customer owns or has been added to, newest update first. */
export async function listMyTickets(
  userId: string,
): Promise<CustomerTicketSummary[]> {
  const assignee = alias(users, "assignee");
  return db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      status: tickets.status,
      priority: tickets.priority,
      createdAt: tickets.createdAt,
      updatedAt: tickets.updatedAt,
      resolvedAt: tickets.resolvedAt,
      assignedToName: assignee.name,
      assignedToEmail: assignee.email,
      // Drives the "Shared with you" badge — these are someone else's tickets.
      sharedWithMe: sql<boolean>`${tickets.customerId} is distinct from ${userId}`,
    })
    .from(tickets)
    .leftJoin(assignee, eq(assignee.id, tickets.assignedToId))
    .where(myTicketsCondition(userId))
    .orderBy(desc(tickets.updatedAt));
}

/**
 * Fetches a single ticket the customer owns. Returns null if the ticket
 * doesn't exist OR belongs to someone else — callers should `notFound()`
 * either way.
 */
export async function getMyTicketByNumber(
  userId: string,
  ticketNumber: string,
): Promise<CustomerTicket | null> {
  const [t] = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      customerEmail: tickets.customerEmail,
      customerName: tickets.customerName,
      subject: tickets.subject,
      description: tickets.description,
      category: tickets.category,
      priority: tickets.priority,
      status: tickets.status,
      createdAt: tickets.createdAt,
      updatedAt: tickets.updatedAt,
      resolvedAt: tickets.resolvedAt,
      closedAt: tickets.closedAt,
      csatResponse: tickets.csatResponse,
      csatRating: tickets.csatRating,
      sharedWithMe: sql<boolean>`${tickets.customerId} is distinct from ${userId}`,
    })
    .from(tickets)
    .where(
      and(eq(tickets.ticketNumber, ticketNumber), myTicketsCondition(userId)),
    )
    .limit(1);
  return t ?? null;
}

/**
 * Guest-mode lookup: load a ticket by number AND require the email
 * (decoded from a verified guest token) to match the customer_email
 * stored on the ticket. Defense-in-depth — even with a valid token,
 * mismatched email returns null. Same shape as `getMyTicketByNumber`
 * so the same renderers work.
 */
/**
 * The ticket behind an ALREADY-AUTHORIZED guest actor (see
 * lib/tickets/guest-actor.ts). No email predicate — authorization happened in
 * resolveGuestActor, which admits the creator and active participants alike.
 * Keeps the non-draft guard.
 */
export async function getGuestTicketById(
  ticketId: string,
): Promise<CustomerTicket | null> {
  const [t] = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      customerEmail: tickets.customerEmail,
      customerName: tickets.customerName,
      subject: tickets.subject,
      description: tickets.description,
      category: tickets.category,
      priority: tickets.priority,
      status: tickets.status,
      createdAt: tickets.createdAt,
      updatedAt: tickets.updatedAt,
      resolvedAt: tickets.resolvedAt,
      closedAt: tickets.closedAt,
      csatResponse: tickets.csatResponse,
      csatRating: tickets.csatRating,
      // Not meaningful on the guest surface: that page already knows who the
      // holder of the link is, from resolveGuestActor's `isCreator`.
      sharedWithMe: sql<boolean>`false`,
    })
    .from(tickets)
    // isNull(deletedAt): a soft-deleted ticket is gone for the guest surface
    // too — guest tokens never expire, so this is what retires the link.
    .where(
      and(
        eq(tickets.id, ticketId),
        ne(tickets.status, "draft"),
        isNull(tickets.deletedAt),
      ),
    )
    .limit(1);
  return t ?? null;
}


/**
 * Returns customer-visible messages for a ticket, with their non-internal
 * attachments. Internal notes are filtered at the SQL layer via
 * `customerVisibleMessages()`. Author email is intentionally NOT projected.
 */
export async function getMyMessageThread(
  ticketId: string,
): Promise<CustomerMessage[]> {
  const rows = await db
    .select({
      id: messages.id,
      authorType: messages.authorType,
      authorName: messages.authorName,
      body: messages.body,
      bodyFormat: messages.bodyFormat,
      channel: messages.channel,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(eq(messages.ticketId, ticketId), customerVisibleMessages()))
    .orderBy(asc(messages.createdAt));

  if (rows.length === 0) return [];

  const messageIds = rows.map((r) => r.id);
  const atts = await db
    .select({
      id: attachments.id,
      messageId: attachments.messageId,
      fileName: attachments.originalFileName,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
      scanStatus: attachments.scanStatus,
    })
    .from(attachments)
    .where(
      and(
        eq(attachments.scanStatus, "clean"),
        inArray(attachments.messageId, messageIds),
      ),
    );

  const attsByMessage = new Map<string, CustomerAttachment[]>();
  for (const a of atts) {
    if (!a.messageId) continue;
    const list = attsByMessage.get(a.messageId) ?? [];
    list.push({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      scanStatus: a.scanStatus,
    });
    attsByMessage.set(a.messageId, list);
  }

  return rows.map((r) => ({
    id: r.id,
    authorType: r.authorType as "agent" | "customer" | "system",
    authorName: r.authorName,
    body: r.body,
    bodyFormat: r.bodyFormat,
    channel: r.channel,
    createdAt: r.createdAt,
    attachments: attsByMessage.get(r.id) ?? [],
  }));
}


// ── Org colleagues (participants picker) ──────────────────────────────

export type OrgColleague = { id: string; name: string };

/**
 * Other CUSTOMERS in the caller's own organization, for the "add people to
 * this ticket" picker. Returns ids + display names only — never a list of
 * email addresses, which would be an org directory dump.
 *
 * Scope is derived from the caller's own `users` row, never from an argument.
 * Staff are excluded by a NOT EXISTS over their roles, not by `roles.name =
 * 'Customer'` alone: roles are additive, so a Coordinator who also holds
 * Customer would otherwise be listed (mirrors isStrictCustomer's intent).
 * Returns [] when the account has no organization.
 */
export async function listMyOrgColleagues(
  userId: string,
): Promise<OrgColleague[]> {
  const [me] = await db
    .select({ organizationId: users.organizationId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!me?.organizationId) return [];

  const staffRoles = ["Super Admin", "IT Director", "Coordinator", "Technician"];

  return db
    .selectDistinct({ id: users.id, name: users.name })
    .from(users)
    .innerJoin(
      organizations,
      eq(organizations.id, users.organizationId),
    )
    .where(
      and(
        eq(users.organizationId, me.organizationId),
        eq(users.isActive, true),
        ne(users.id, userId),
        eq(organizations.isActive, true),
        // Never expose the internal Axiom360 org's people through a customer
        // picker, even to a Customer-role account attached to it.
        eq(organizations.isInternal, false),
        exists(
          db
            .select({ one: userRoles.userId })
            .from(userRoles)
            .innerJoin(roles, eq(roles.id, userRoles.roleId))
            .where(
              and(eq(userRoles.userId, users.id), eq(roles.name, "Customer")),
            ),
        ),
        notExists(
          db
            .select({ one: userRoles.userId })
            .from(userRoles)
            .innerJoin(roles, eq(roles.id, userRoles.roleId))
            .where(
              and(
                eq(userRoles.userId, users.id),
                inArray(roles.name, staffRoles),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(users.name));
}
