"use server";

import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { requireSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { attachments } from "@/lib/db/schema/attachments";
import { users } from "@/lib/db/schema/auth";
import { messages } from "@/lib/db/schema/messages";
import { tickets } from "@/lib/db/schema/tickets";
import { sendEmail } from "@/lib/email/send";
import { checkRateLimit } from "@/lib/ratelimit";
import { inngest } from "@/inngest/client";
import { getSetting } from "@/lib/settings";
import { computeDueTimesForNewTicket, type Priority } from "@/lib/sla";
import { generateTicketNumber } from "@/lib/ticket-number";
import { signCsatToken, signGuestToken } from "@/lib/tokens";
import { verifyTurnstile } from "@/lib/turnstile";

// ── Public ticket submission (no auth required) ──────────────────────

const TICKET_CATEGORIES = [
  "hardware",
  "software",
  "network",
  "access",
  "other",
] as const;
const TICKET_PRIORITIES = ["low", "medium", "high", "critical"] as const;

export const createTicketSchema = z.object({
  customerName: z.string().trim().min(1, "Name is required").max(120),
  customerEmail: z.string().trim().toLowerCase().email("Enter a valid email"),
  subject: z
    .string()
    .trim()
    .min(3, "Subject must be at least 3 characters")
    .max(150, "Subject must be at most 150 characters"),
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(TICKET_PRIORITIES),
  description: z
    .string()
    .trim()
    .min(20, "Description must be at least 20 characters")
    .max(5000, "Description must be at most 5000 characters"),
  // Anti-abuse — invisible to humans
  turnstileToken: z.string().optional(),
  honeypot: z.string().optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export type CreateTicketResult =
  | { ok: true; ticketNumber: string }
  | { ok: false; error: string };

export async function createTicket(
  input: CreateTicketInput,
): Promise<CreateTicketResult> {
  // 1. Validate input shape
  const parsed = createTicketSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  // 2. Honeypot — silently drop bots (return success-shape so they don't retry)
  if (data.honeypot && data.honeypot.length > 0) {
    return { ok: true, ticketNumber: "AX-XXXX" };
  }

  // 3. Read request metadata
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown";
  const userAgent = h.get("user-agent") ?? undefined;

  // 4. Rate limits — IP and email
  const ipLimit = await checkRateLimit("publicSubmitByIp", `submit:ip:${ip}`);
  if (!ipLimit.allowed) {
    return {
      ok: false,
      error: "Too many submissions from your network. Try again in an hour.",
    };
  }
  const emailLimit = await checkRateLimit(
    "publicSubmitByEmail",
    `submit:email:${data.customerEmail}`,
  );
  if (!emailLimit.allowed) {
    return {
      ok: false,
      error:
        "Too many submissions from this email today. Try again tomorrow.",
    };
  }

  // 5. Turnstile (skipped in dev without secret; required in prod)
  const turnstile = await verifyTurnstile(data.turnstileToken, ip);
  if (!turnstile.success) {
    return {
      ok: false,
      error: "Captcha verification failed. Please refresh the page and try again.",
    };
  }

  // 6. Determine stream (internal vs external) by email domain
  const internalDomains =
    (await getSetting<string[]>("internal_email_domains")) ?? [];
  const emailDomain = data.customerEmail.split("@")[1]?.toLowerCase() ?? "";
  const stream = internalDomains
    .map((d) => d.toLowerCase())
    .includes(emailDomain)
    ? "internal"
    : "external";

  // 7. Generate ticket number + compute SLA deadlines
  const ticketNumber = await generateTicketNumber();
  const createdAt = new Date();
  const { responseDueAt, resolutionDueAt } = await computeDueTimesForNewTicket({
    createdAt,
    priority: data.priority as Priority,
  });

  // 8. Insert ticket + initial message in a transaction
  await db.transaction(async (tx) => {
    const [ticket] = await tx
      .insert(tickets)
      .values({
        ticketNumber,
        subject: data.subject,
        description: data.description,
        category: data.category,
        priority: data.priority,
        status: "open",
        stream,
        origin: "web_form",
        customerEmail: data.customerEmail,
        customerName: data.customerName,
        createdAt,
        responseDueAt,
        resolutionDueAt,
      })
      .returning({ id: tickets.id });

    // Initial message capturing the description (so it shows up in the thread)
    await tx.insert(messages).values({
      ticketId: ticket.id,
      authorEmail: data.customerEmail,
      authorName: data.customerName,
      authorType: "customer",
      body: data.description,
      channel: "portal",
    });
  });

  // 9. Audit log
  await audit({
    actorId: null,
    action: "ticket.create",
    targetType: "ticket",
    targetId: ticketNumber,
    after: {
      ticketNumber,
      subject: data.subject,
      category: data.category,
      priority: data.priority,
      stream,
      origin: "web_form",
    },
    ipAddress: ip,
    userAgent,
  });

  // 10. Send confirmation email (inline for now; Inngest fan-out comes later)
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const guestToken = signGuestToken(ticketNumber, data.customerEmail);
    const trackingUrl = `${appUrl}/portal/tickets/${ticketNumber}?token=${guestToken}`;

    await sendEmail({
      to: data.customerEmail,
      template: {
        template: "ticket_created",
        data: {
          ticketNumber,
          customerName: data.customerName,
          subject: data.subject,
          trackingUrl,
        },
      },
      ticketNumber,
      replyToTicket: true,
    });
  } catch (err) {
    // Don't fail the ticket creation if email send fails — the ticket exists,
    // and the customer can use the portal. Log for follow-up.
    console.error("[createTicket] failed to send confirmation email:", err);
  }

  // 11. Emit Inngest event so async listeners (notifications, future jobs) can react
  // (Skipped here for Phase A; notification fan-out lands in M11.)

  return { ok: true, ticketNumber };
}

// ── Coordinator: create on behalf of a customer ──────────────────────

export const createOnBehalfSchema = z.object({
  customerName: z.string().trim().min(1, "Name is required").max(120),
  customerEmail: z.string().trim().toLowerCase().email("Enter a valid email"),
  subject: z
    .string()
    .trim()
    .min(3, "Subject must be at least 3 characters")
    .max(150, "Subject must be at most 150 characters"),
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(TICKET_PRIORITIES),
  description: z
    .string()
    .trim()
    .min(20, "Description must be at least 20 characters")
    .max(5000),
});

export type CreateOnBehalfInput = z.infer<typeof createOnBehalfSchema>;
export type CreateOnBehalfResult =
  | { ok: true; ticketNumber: string }
  | { ok: false; error: string };

export async function createTicketOnBehalf(
  input: CreateOnBehalfInput,
): Promise<CreateOnBehalfResult> {
  const user = await requireSessionUser();
  if (!(await can(user, "tickets.create", { type: "global" }, productionContext))) {
    return { ok: false, error: "You don't have permission to create tickets." };
  }

  const parsed = createOnBehalfSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const data = parsed.data;

  const internalDomains =
    (await getSetting<string[]>("internal_email_domains")) ?? [];
  const emailDomain = data.customerEmail.split("@")[1]?.toLowerCase() ?? "";
  const stream = internalDomains
    .map((d) => d.toLowerCase())
    .includes(emailDomain)
    ? "internal"
    : "external";

  const ticketNumber = await generateTicketNumber();
  const createdAt = new Date();
  const { responseDueAt, resolutionDueAt } = await computeDueTimesForNewTicket({
    createdAt,
    priority: data.priority as Priority,
  });

  await db.transaction(async (tx) => {
    const [ticket] = await tx
      .insert(tickets)
      .values({
        ticketNumber,
        subject: data.subject,
        description: data.description,
        category: data.category,
        priority: data.priority,
        status: "open",
        stream,
        // Origin "portal" because the agent is using the dashboard portal,
        // not the public web form. (web_form/email/portal — see schema check.)
        origin: "portal",
        customerEmail: data.customerEmail,
        customerName: data.customerName,
        createdAt,
        responseDueAt,
        resolutionDueAt,
      })
      .returning({ id: tickets.id });

    await tx.insert(messages).values({
      ticketId: ticket.id,
      authorEmail: data.customerEmail,
      authorName: data.customerName,
      authorType: "customer",
      body: data.description,
      channel: "portal",
    });
  });

  await audit({
    actorId: user.id,
    action: "ticket.create_on_behalf",
    targetType: "ticket",
    targetId: ticketNumber,
    after: {
      ticketNumber,
      subject: data.subject,
      category: data.category,
      priority: data.priority,
      stream,
      customerEmail: data.customerEmail,
    },
  });

  // Confirmation email to the customer (best-effort).
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const guestToken = signGuestToken(ticketNumber, data.customerEmail);
    const trackingUrl = `${appUrl}/portal/tickets/${ticketNumber}?token=${guestToken}`;
    await sendEmail({
      to: data.customerEmail,
      template: {
        template: "ticket_created",
        data: {
          ticketNumber,
          customerName: data.customerName,
          subject: data.subject,
          trackingUrl,
        },
      },
      ticketNumber,
      replyToTicket: true,
    });
  } catch (err) {
    console.error("[createTicketOnBehalf] confirmation email failed:", err);
  }

  revalidatePath("/admin/tickets");
  return { ok: true, ticketNumber };
}

// ── Helpers shared by authenticated actions ──────────────────────────

async function loadTicketScope(ticketId: string) {
  const [t] = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      assignedToId: tickets.assignedToId,
      customerId: tickets.customerId,
      customerEmail: tickets.customerEmail,
      customerName: tickets.customerName,
      status: tickets.status,
      isEscalated: tickets.isEscalated,
      priority: tickets.priority,
    })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  return t;
}

class ForbiddenError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "ForbiddenError";
  }
}
class NotFoundError extends Error {
  constructor() {
    super("Not found");
    this.name = "NotFoundError";
  }
}

// ── Assignment ──────────────────────────────────────────────────────

export async function assignTicket(
  ticketId: string,
  techId: string,
): Promise<void> {
  const user = await requireSessionUser();
  const ticket = await loadTicketScope(ticketId);
  if (!ticket) throw new NotFoundError();

  if (
    !(await can(
      user,
      "tickets.assign",
      { type: "ticket", ticket },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  // Verify the target user exists and is active
  const [tech] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      language: users.language,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, techId))
    .limit(1);
  if (!tech) throw new NotFoundError();
  if (!tech.isActive) {
    throw new Error("Cannot assign to a deactivated user");
  }

  const before = { assignedToId: ticket.assignedToId };
  const newStatus = ticket.status === "open" ? "in_progress" : ticket.status;

  await db
    .update(tickets)
    .set({
      assignedToId: techId,
      assignedAt: new Date(),
      status: newStatus,
      updatedAt: new Date(),
    })
    .where(eq(tickets.id, ticketId));

  await audit({
    actorId: user.id,
    action: "ticket.assign",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    before,
    after: { assignedToId: techId, status: newStatus },
  });

  // Notify customer (best-effort)
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const guestToken = signGuestToken(ticket.ticketNumber, ticket.customerEmail);
    const trackingUrl = `${appUrl}/portal/tickets/${ticket.ticketNumber}?token=${guestToken}`;
    await sendEmail({
      to: ticket.customerEmail,
      template: {
        template: "ticket_assigned",
        data: {
          ticketNumber: ticket.ticketNumber,
          customerName: ticket.customerName,
          subject: ticket.subject,
          technicianName: tech.name,
          trackingUrl,
        },
      },
      ticketNumber: ticket.ticketNumber,
      replyToTicket: true,
    });
  } catch (err) {
    console.error("[assignTicket] customer email failed:", err);
  }

  // Notify the assigned tech via the M11 dispatch fan-out — emits ONE
  // event; the dispatcher gates email/sms by the user's preferences and
  // always inserts an in-app notification.
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const ticketUrl = `${appUrl}/admin/tickets/${ticket.id}`;
    await inngest.send({
      name: "notification/dispatch",
      data: {
        type: "ticket.assigned",
        recipientUserIds: [techId],
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        email: {
          template: {
            template: "new_assignment",
            data: {
              ticketNumber: ticket.ticketNumber,
              technicianName: tech.name,
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
    console.error("[assignTicket] dispatch failed:", err);
  }

  revalidatePath("/admin/tickets");
  revalidatePath(`/admin/tickets/${ticketId}`);
}

// ── Reply (visible to customer) ──────────────────────────────────────

const replySchema = z.object({
  body: z.string().trim().min(1, "Reply cannot be empty").max(10000),
  attachmentIds: z.array(z.string().uuid()).max(5).default([]),
});

export async function replyToTicket(
  ticketId: string,
  body: string,
  attachmentIds: string[] = [],
): Promise<void> {
  const parsed = replySchema.safeParse({ body, attachmentIds });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid reply");
  }

  const user = await requireSessionUser();
  const ticket = await loadTicketScope(ticketId);
  if (!ticket) throw new NotFoundError();

  if (
    !(await can(
      user,
      "tickets.reply",
      { type: "ticket", ticket },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  // Resolve the agent's display name + email for the message + outbound email
  const [agent] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!agent) throw new NotFoundError();

  // First agent reply sets first_response_at (used by SLA monitor in M9)
  const isFirstAgentReply = ticket.status === "open";

  await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(messages)
      .values({
        ticketId: ticket.id,
        authorId: user.id,
        authorEmail: agent.email,
        authorName: agent.name,
        authorType: "agent",
        body: parsed.data.body,
        channel: "dashboard",
      })
      .returning({ id: messages.id });

    if (parsed.data.attachmentIds.length > 0) {
      await tx
        .update(attachments)
        .set({ messageId: inserted.id })
        .where(
          and(
            inArray(attachments.id, parsed.data.attachmentIds),
            eq(attachments.ticketId, ticket.id),
            eq(attachments.uploadedById, user.id),
            isNull(attachments.messageId),
            ne(attachments.scanStatus, "quarantined"),
          ),
        );
    }

    const update: Partial<typeof tickets.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (isFirstAgentReply) {
      update.firstResponseAt = new Date();
      // Don't auto-flip status here; assignment is what moves to in_progress.
    }
    await tx.update(tickets).set(update).where(eq(tickets.id, ticket.id));
  });

  await audit({
    actorId: user.id,
    action: "ticket.reply",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    after: { length: parsed.data.body.length },
  });

  // Email the customer (best-effort)
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const guestToken = signGuestToken(ticket.ticketNumber, ticket.customerEmail);
    const trackingUrl = `${appUrl}/portal/tickets/${ticket.ticketNumber}?token=${guestToken}`;
    await sendEmail({
      to: ticket.customerEmail,
      template: {
        template: "ticket_reply",
        data: {
          ticketNumber: ticket.ticketNumber,
          customerName: ticket.customerName,
          subject: ticket.subject,
          agentName: agent.name,
          body: parsed.data.body,
          trackingUrl,
        },
      },
      ticketNumber: ticket.ticketNumber,
      replyToTicket: true,
    });
  } catch (err) {
    console.error("[replyToTicket] email failed:", err);
  }

  revalidatePath(`/admin/tickets/${ticketId}`);
}

// ── Internal note (agent-only, never visible to customer) ────────────

const internalNoteSchema = z.object({
  body: z.string().trim().min(1, "Internal note cannot be empty").max(10000),
  attachmentIds: z.array(z.string().uuid()).max(5).default([]),
});

export async function addInternalNote(
  ticketId: string,
  body: string,
  attachmentIds: string[] = [],
): Promise<void> {
  const parsed = internalNoteSchema.safeParse({ body, attachmentIds });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid note");
  }

  const user = await requireSessionUser();
  const ticket = await loadTicketScope(ticketId);
  if (!ticket) throw new NotFoundError();

  if (
    !(await can(
      user,
      "tickets.internal_note",
      { type: "ticket", ticket },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  const [agent] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!agent) throw new NotFoundError();

  await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(messages)
      .values({
        ticketId: ticket.id,
        authorId: user.id,
        authorEmail: agent.email,
        authorName: agent.name,
        authorType: "agent",
        body: parsed.data.body,
        channel: "dashboard",
        isInternalNote: true,
      })
      .returning({ id: messages.id });

    if (parsed.data.attachmentIds.length > 0) {
      await tx
        .update(attachments)
        .set({ messageId: inserted.id })
        .where(
          and(
            inArray(attachments.id, parsed.data.attachmentIds),
            eq(attachments.ticketId, ticket.id),
            eq(attachments.uploadedById, user.id),
            isNull(attachments.messageId),
            ne(attachments.scanStatus, "quarantined"),
          ),
        );
    }
  });

  await audit({
    actorId: user.id,
    action: "ticket.internal_note",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    after: { length: parsed.data.body.length },
  });

  // Notification fan-out (assigned tech, coordinators) lands with M11.
  // Crucially: NO customer email path here.

  revalidatePath(`/admin/tickets/${ticketId}`);
}

// ── Resolve ──────────────────────────────────────────────────────────

const resolveSchema = z.object({
  note: z
    .string()
    .trim()
    .min(10, "Resolution note must be at least 10 characters")
    .max(5000),
});

export async function resolveTicket(
  ticketId: string,
  note: string,
): Promise<void> {
  const parsed = resolveSchema.safeParse({ note });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid note");
  }

  const user = await requireSessionUser();
  const ticket = await loadTicketScope(ticketId);
  if (!ticket) throw new NotFoundError();

  if (
    !(await can(
      user,
      "tickets.resolve",
      { type: "ticket", ticket },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  if (ticket.status === "resolved" || ticket.status === "closed") {
    throw new Error("Ticket is already resolved or closed");
  }

  const [agent] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!agent) throw new NotFoundError();

  await db.transaction(async (tx) => {
    await tx.insert(messages).values({
      ticketId: ticket.id,
      authorId: user.id,
      authorEmail: agent.email,
      authorName: agent.name,
      authorType: "agent",
      body: parsed.data.note,
      channel: "dashboard",
      isResolutionNote: true,
    });
    await tx
      .update(tickets)
      .set({
        status: "resolved",
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tickets.id, ticket.id));
  });

  await audit({
    actorId: user.id,
    action: "ticket.resolve",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    before: { status: ticket.status },
    after: { status: "resolved" },
  });

  // CSAT email — best-effort. Auto-close runs hourly in
  // `inngest/functions/auto-close-resolved.ts`.
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const guestToken = signGuestToken(ticket.ticketNumber, ticket.customerEmail);
    const trackingUrl = `${appUrl}/portal/tickets/${ticket.ticketNumber}?token=${guestToken}`;
    const satToken = signCsatToken(ticket.ticketNumber, "satisfied");
    const unsatToken = signCsatToken(ticket.ticketNumber, "unsatisfied");
    await sendEmail({
      to: ticket.customerEmail,
      template: {
        template: "ticket_resolved",
        data: {
          ticketNumber: ticket.ticketNumber,
          customerName: ticket.customerName,
          subject: ticket.subject,
          agentName: agent.name,
          resolutionNote: parsed.data.note,
          csatSatisfiedUrl: `${appUrl}/csat/confirm?t=${ticket.ticketNumber}&tk=${satToken}`,
          csatUnsatisfiedUrl: `${appUrl}/csat/confirm?t=${ticket.ticketNumber}&tk=${unsatToken}`,
          trackingUrl,
        },
      },
      ticketNumber: ticket.ticketNumber,
      replyToTicket: true,
    });
  } catch (err) {
    console.error("[resolveTicket] CSAT email failed:", err);
  }

  revalidatePath("/admin/tickets");
  revalidatePath(`/admin/tickets/${ticketId}`);
}

// ── Reopen ───────────────────────────────────────────────────────────

export async function reopenTicket(ticketId: string): Promise<void> {
  const user = await requireSessionUser();
  const ticket = await loadTicketScope(ticketId);
  if (!ticket) throw new NotFoundError();

  if (
    !(await can(
      user,
      "tickets.reopen",
      { type: "ticket", ticket },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  if (ticket.status !== "resolved" && ticket.status !== "closed") {
    throw new Error("Only resolved or closed tickets can be reopened");
  }

  // If still assigned, go straight back to in_progress; otherwise back to open.
  const newStatus = ticket.assignedToId ? "in_progress" : "open";

  await db
    .update(tickets)
    .set({
      status: newStatus,
      resolvedAt: null,
      closedAt: null,
      reopenedCount: sql`${tickets.reopenedCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(tickets.id, ticket.id));

  await audit({
    actorId: user.id,
    action: "ticket.reopen",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    before: { status: ticket.status },
    after: { status: newStatus },
  });

  // Notify customer (best-effort)
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const guestToken = signGuestToken(ticket.ticketNumber, ticket.customerEmail);
    const trackingUrl = `${appUrl}/portal/tickets/${ticket.ticketNumber}?token=${guestToken}`;
    await sendEmail({
      to: ticket.customerEmail,
      template: {
        template: "ticket_reopened",
        data: {
          ticketNumber: ticket.ticketNumber,
          customerName: ticket.customerName,
          subject: ticket.subject,
          reason: "agent",
          trackingUrl,
        },
      },
      ticketNumber: ticket.ticketNumber,
      replyToTicket: true,
    });
  } catch (err) {
    console.error("[reopenTicket] customer email failed:", err);
  }

  revalidatePath("/admin/tickets");
  revalidatePath(`/admin/tickets/${ticketId}`);
}

// ── Escalate / De-escalate ───────────────────────────────────────────

const escalateSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Escalation reason must be at least 10 characters")
    .max(1000),
});

export async function escalateTicket(
  ticketId: string,
  reason: string,
): Promise<void> {
  const parsed = escalateSchema.safeParse({ reason });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid reason");
  }

  const user = await requireSessionUser();
  const ticket = await loadTicketScope(ticketId);
  if (!ticket) throw new NotFoundError();

  if (
    !(await can(
      user,
      "tickets.escalate",
      { type: "ticket", ticket },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  if (ticket.isEscalated) {
    throw new Error("Ticket is already escalated");
  }

  const [actor] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  await db
    .update(tickets)
    .set({
      isEscalated: true,
      escalatedAt: new Date(),
      escalatedById: user.id,
      escalationReason: parsed.data.reason,
      updatedAt: new Date(),
    })
    .where(eq(tickets.id, ticket.id));

  await audit({
    actorId: user.id,
    action: "ticket.escalate",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    after: { reason: parsed.data.reason },
  });

  // Notify IT Director + Coordinator via dispatch fan-out.
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const ticketUrl = `${appUrl}/admin/tickets/${ticket.id}`;
    const technicianName = actor?.name ?? "An agent";
    await inngest.send({
      name: "notification/dispatch",
      data: {
        type: "ticket.escalated",
        recipientRoles: ["IT Director", "Coordinator"],
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        email: {
          template: {
            template: "escalation_alert",
            data: {
              ticketNumber: ticket.ticketNumber,
              recipientName: "Team",
              subject: ticket.subject,
              technicianName,
              reason: parsed.data.reason,
              customerName: ticket.customerName,
              ticketUrl,
            },
          },
          ticketNumber: ticket.ticketNumber,
        },
        inApp: {
          titleArgs: { ticketNumber: ticket.ticketNumber },
          bodyArgs: { technicianName, subject: ticket.subject },
          linkUrl: `/admin/tickets/${ticket.id}`,
        },
      },
    });
  } catch (err) {
    console.error("[escalateTicket] dispatch failed:", err);
  }

  revalidatePath("/admin/tickets");
  revalidatePath(`/admin/tickets/${ticketId}`);
}

export async function deescalateTicket(ticketId: string): Promise<void> {
  const user = await requireSessionUser();
  const ticket = await loadTicketScope(ticketId);
  if (!ticket) throw new NotFoundError();

  if (
    !(await can(
      user,
      "tickets.deescalate",
      { type: "ticket", ticket },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  if (!ticket.isEscalated) return;

  await db
    .update(tickets)
    .set({
      isEscalated: false,
      escalatedAt: null,
      escalatedById: null,
      escalationReason: null,
      updatedAt: new Date(),
    })
    .where(eq(tickets.id, ticket.id));

  await audit({
    actorId: user.id,
    action: "ticket.deescalate",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
  });

  revalidatePath("/admin/tickets");
  revalidatePath(`/admin/tickets/${ticketId}`);
}
