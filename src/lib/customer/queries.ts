import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { attachments } from "@/lib/db/schema/attachments";
import { messages } from "@/lib/db/schema/messages";
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
};

export type CustomerTicket = {
  id: string;
  ticketNumber: string;
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

/** Lists tickets the customer owns, most recently updated first. */
export async function listMyTickets(
  userId: string,
): Promise<CustomerTicketSummary[]> {
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
    })
    .from(tickets)
    .where(eq(tickets.customerId, userId))
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
    })
    .from(tickets)
    .where(
      and(
        eq(tickets.ticketNumber, ticketNumber),
        eq(tickets.customerId, userId),
      ),
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
export async function getGuestTicket(
  ticketNumber: string,
  customerEmail: string,
): Promise<CustomerTicket | null> {
  const [t] = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
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
    })
    .from(tickets)
    .where(
      and(
        eq(tickets.ticketNumber, ticketNumber),
        eq(tickets.customerEmail, customerEmail.toLowerCase()),
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
