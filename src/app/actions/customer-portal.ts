"use server";

import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { requireSessionUser } from "@/lib/auth/session";
import { db, transactional } from "@/lib/db/client";
import { attachments } from "@/lib/db/schema/attachments";
import { users } from "@/lib/db/schema/auth";
import { messages } from "@/lib/db/schema/messages";
import { tickets } from "@/lib/db/schema/tickets";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import {
  checkRateLimit,
  enforceUserRateLimit,
} from "@/lib/ratelimit";
import { clientIp } from "@/lib/request";
import { computeDueTimesForNewTicket, type Priority } from "@/lib/sla";
import { generateTicketNumber } from "@/lib/ticket-number";
import { loadTicketScope } from "@/lib/tickets/load";
import { classifyStream } from "@/lib/tickets/stream";
import {
  htmlToPlainText,
  sanitizeMessageHtml,
} from "@/lib/messages/sanitize";
import { verifyGuestToken } from "@/lib/tokens";
import { inngest } from "@/inngest/client";

const emailSchema = z.string().trim().toLowerCase().email();
const nameSchema = z.string().trim().min(1).max(120);
// Optional E.164 phone — accepts "" (cleared) or a real number. Stored
// as null in the DB when empty. Used by the SMS dispatch leg downstream.
const phoneSchema = z
  .string()
  .trim()
  .max(20)
  .regex(
    /^(\+?[1-9]\d{1,14})?$/,
    "Phone must be in E.164 format (e.g. +14165550123)",
  )
  .optional();

export type RequestMagicLinkResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "invalid_email"
        | "rate_limited_email"
        | "rate_limited_ip"
        | "account_not_found";
    };

export type RequestSignUpResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "invalid_email"
        | "invalid_name"
        | "invalid_phone"
        | "rate_limited_email"
        | "rate_limited_ip";
    };

/**
 * Request a magic-link sign-in email. Sign-in is for **existing accounts
 * only** — if the email doesn't map to a user row, we return
 * `account_not_found` so the UI can route the visitor to `/portal/sign-up`
 * where the name field is collected. Sign-up explicitly creates new users
 * via `requestSignUpMagicLink`.
 *
 * Trade-off: this leaks which emails are registered (an attacker can probe
 * for known users). Acceptable for an internal IT ticketing tool where
 * email enumeration isn't a material risk, and worth the win of every
 * account having a real name attached (cleaner agent dashboards, better
 * email greetings). Rate limits keep probing slow.
 */
export async function requestMagicLink(
  email: string,
): Promise<RequestMagicLinkResult> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { ok: false, error: "invalid_email" };
  const normalized = parsed.data;

  const h = await headers();
  const ip = clientIp(h);

  // Rate-limit FIRST so an attacker can't run an unbounded enumeration
  // query against the users table.
  const ipLimit = await checkRateLimit("magicLinkByIp", `magic:ip:${ip}`);
  if (!ipLimit.allowed) return { ok: false, error: "rate_limited_ip" };

  const emailLimit = await checkRateLimit(
    "magicLinkByEmail",
    `magic:email:${normalized}`,
  );
  if (!emailLimit.allowed) return { ok: false, error: "rate_limited_email" };

  // Existence check: reject sign-in for unknown emails so the flow forces
  // new users through `/portal/sign-up` (where name is captured).
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);
  if (!existing) {
    return { ok: false, error: "account_not_found" };
  }

  try {
    await auth.api.signInMagicLink({
      body: {
        email: normalized,
        callbackURL: "/portal/tickets",
        // `newUserCallbackURL` kept defensively; the existence check
        // above already rules out new accounts on this path, but Better
        // Auth's request validator may require the field to be present.
        newUserCallbackURL: "/portal/tickets",
        errorCallbackURL: "/portal/sign-in?error=expired",
      },
      headers: h,
    });
  } catch (err) {
    // Swallowed for delivery failures (e.g. Resend outage). In dev we
    // still surface it so silent send failures (unverified domain, free
    // -tier sandbox, bad key) don't masquerade as "we sent the email."
    if (process.env.NODE_ENV !== "production") {
      console.error("[magicLink] send failed:", err);
    }
  }

  return { ok: true };
}

/**
 * Sign-up flow: same magic-link delivery, with `name` carried through so the
 * `databaseHooks.user.create.after` hook receives it when the link is verified.
 * Distinguished from `requestMagicLink` because the UX shows a name field.
 */
export async function requestSignUpMagicLink(
  name: string,
  email: string,
  phone?: string,
): Promise<RequestSignUpResult> {
  const parsedName = nameSchema.safeParse(name);
  if (!parsedName.success) return { ok: false, error: "invalid_name" };
  const parsedEmail = emailSchema.safeParse(email);
  if (!parsedEmail.success) return { ok: false, error: "invalid_email" };
  const parsedPhone = phoneSchema.safeParse(phone ?? "");
  if (!parsedPhone.success) return { ok: false, error: "invalid_phone" };
  // Empty string → null in the DB (no phone configured → no SMS).
  const normalizedPhone =
    parsedPhone.data && parsedPhone.data.length > 0 ? parsedPhone.data : null;
  const normalized = parsedEmail.data;

  const h = await headers();
  const ip = clientIp(h);

  const ipLimit = await checkRateLimit("magicLinkByIp", `magic:ip:${ip}`);
  if (!ipLimit.allowed) return { ok: false, error: "rate_limited_ip" };

  const emailLimit = await checkRateLimit(
    "magicLinkByEmail",
    `magic:email:${normalized}`,
  );
  if (!emailLimit.allowed) return { ok: false, error: "rate_limited_email" };

  try {
    await auth.api.signInMagicLink({
      body: {
        email: normalized,
        name: parsedName.data,
        // `phone` lives in Better Auth's `additionalFields` config so it's
        // persisted on the users row when the magic link is verified for
        // a brand-new account. Null/empty is fine — the dispatch SMS leg
        // gates on `r.phone` being truthy and silently skips otherwise.
        ...(normalizedPhone ? { phone: normalizedPhone } : {}),
        callbackURL: "/portal/tickets",
        newUserCallbackURL: "/portal/tickets",
        errorCallbackURL: "/portal/sign-in?error=expired",
      },
      headers: h,
    });
  } catch (err) {
    // Same rationale as requestMagicLink — preserve generic success in prod,
    // surface in dev so failed sends aren't silent.
    if (process.env.NODE_ENV !== "production") {
      console.error("[magicLink/signUp] send failed:", err);
    }
  }

  return { ok: true };
}

// ── Customer reply ─────────────────────────────────────────────────

const replySchema = z.object({
  body: z.string().trim().min(1, "Reply cannot be empty").max(10000),
  attachmentIds: z.array(z.string().uuid()).max(5).default([]),
});

export type CustomerReplyResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Customer-channel reply. Mirrors the agent `replyToTicket` shape but always
 * inserts as `authorType: "customer"`, `channel: "portal"`, and dispatches the
 * `ticket.customer_replied` notification to the assigned tech instead of the
 * customer themselves. Closed tickets refuse the reply.
 */
export async function customerReply(
  ticketId: string,
  body: string,
  attachmentIds: string[] = [],
): Promise<CustomerReplyResult> {
  const parsed = replySchema.safeParse({ body, attachmentIds });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid reply" };
  }

  const user = await requireSessionUser();
  if (!user.roleNames.has("Customer")) {
    throw new ForbiddenError();
  }

  await enforceUserRateLimit("authReply", user.id);

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

  if (ticket.status === "closed") {
    return { ok: false, error: "Ticket is closed." };
  }

  const [profile] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!profile) throw new NotFoundError();

  // Portal composer produces HTML; allowlist-strip server-side. Reject
  // if the visible content is empty.
  const cleanBody = sanitizeMessageHtml(parsed.data.body);
  if (htmlToPlainText(cleanBody).length === 0) {
    return { ok: false, error: "Reply cannot be empty" };
  }

  await transactional(async (tx) => {
    const [inserted] = await tx
      .insert(messages)
      .values({
        ticketId: ticket.id,
        authorId: user.id,
        authorEmail: profile.email,
        authorName: profile.name,
        authorType: "customer",
        body: cleanBody,
        bodyFormat: "html",
        channel: "portal",
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

    await tx
      .update(tickets)
      .set({ updatedAt: new Date() })
      .where(eq(tickets.id, ticket.id));
  });

  await audit({
    actorId: user.id,
    action: "ticket.customer_reply",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    after: { length: parsed.data.body.length },
  });

  if (ticket.assignedToId) {
    try {
      await inngest.send({
        name: "notification/dispatch",
        data: {
          type: "ticket.customer_replied",
          recipientUserIds: [ticket.assignedToId],
          inApp: {
            titleArgs: { ticketNumber: ticket.ticketNumber },
            bodyArgs: { customerName: profile.name },
            linkUrl: `/admin/tickets/${ticket.id}`,
          },
        },
      });
    } catch (err) {
      console.error("[customerReply] dispatch failed:", err);
    }
  }

  revalidatePath(`/portal/tickets/${ticket.ticketNumber}`);
  revalidatePath("/portal/tickets");
  revalidatePath(`/admin/tickets/${ticket.id}`);
  return { ok: true };
}

// ── Guest reply (token-authenticated, no session) ────────────────

const guestReplySchema = z.object({
  ticketNumber: z.string().trim().min(1).max(40),
  token: z.string().trim().min(1).max(2000),
  body: z.string().trim().min(1, "Reply cannot be empty").max(10000),
});

type GuestReplyResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Spec §7.2: a guest holding a valid signed link can reply to their own
 * ticket without an account. Token verification (HMAC) gives us the
 * email; we re-load the ticket by number AND require email match before
 * inserting (defense-in-depth — even a leaked secret can't be used to
 * reply on someone else's ticket). Author identity is captured from the
 * token, NEVER from client-supplied input. Rate-limited per-ticket and
 * per-IP independently.
 *
 * No attachments in V1 — guests upload nothing. If they need to attach
 * files they can sign up (the reconciliation hook adopts their tickets).
 */
export async function guestReply(input: {
  ticketNumber: string;
  token: string;
  body: string;
}): Promise<GuestReplyResult> {
  const parsed = guestReplySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid reply",
    };
  }
  const { ticketNumber, token, body } = parsed.data;

  const verifiedEmail = verifyGuestToken(token, ticketNumber);
  if (!verifiedEmail) {
    return { ok: false, error: "This link is no longer valid." };
  }

  const h = await headers();
  const ip = clientIp(h);
  const ipLimit = await checkRateLimit("guestReplyByIp", `guest:reply:ip:${ip}`);
  if (!ipLimit.allowed) {
    return { ok: false, error: "Too many replies from your network. Try again shortly." };
  }
  const ticketLimit = await checkRateLimit(
    "guestReplyByTicket",
    `guest:reply:ticket:${ticketNumber}`,
  );
  if (!ticketLimit.allowed) {
    return { ok: false, error: "Too many replies on this ticket. Try again shortly." };
  }

  const [ticket] = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      customerEmail: tickets.customerEmail,
      customerName: tickets.customerName,
      status: tickets.status,
      assignedToId: tickets.assignedToId,
    })
    .from(tickets)
    .where(eq(tickets.ticketNumber, ticketNumber))
    .limit(1);
  if (!ticket || ticket.customerEmail.toLowerCase() !== verifiedEmail.toLowerCase()) {
    // Constant-shape response so token-validity vs. ticket-existence
    // can't be distinguished by error message comparison.
    return { ok: false, error: "This link is no longer valid." };
  }
  if (ticket.status === "closed") {
    return { ok: false, error: "Ticket is closed." };
  }

  // Guest composer also produces HTML — sanitize identically to the
  // auth'd path. Empty after sanitize → reject with the same opaque
  // message as a bad token (avoid leaking validation specifics to a
  // potentially hostile caller).
  const cleanBody = sanitizeMessageHtml(body);
  if (htmlToPlainText(cleanBody).length === 0) {
    return { ok: false, error: "Reply cannot be empty." };
  }

  await transactional(async (tx) => {
    await tx.insert(messages).values({
      ticketId: ticket.id,
      authorId: null, // guest — not yet a registered user
      authorEmail: verifiedEmail,
      authorName: ticket.customerName,
      authorType: "customer",
      body: cleanBody,
      bodyFormat: "html",
      channel: "portal",
    });
    await tx
      .update(tickets)
      .set({ updatedAt: new Date() })
      .where(eq(tickets.id, ticket.id));
  });

  await audit({
    actorId: null,
    action: "ticket.customer_reply",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    after: { length: body.length, channel: "portal", actor_kind: "guest" },
    ipAddress: ip ?? undefined,
  });

  if (ticket.assignedToId) {
    try {
      await inngest.send({
        name: "notification/dispatch",
        data: {
          type: "ticket.customer_replied",
          recipientUserIds: [ticket.assignedToId],
          inApp: {
            titleArgs: { ticketNumber: ticket.ticketNumber },
            bodyArgs: { customerName: ticket.customerName },
            linkUrl: `/admin/tickets/${ticket.id}`,
          },
        },
      });
    } catch (err) {
      console.error("[guestReply] dispatch failed:", err);
    }
  }

  revalidatePath(`/portal/guest/tickets/${ticket.ticketNumber}`);
  revalidatePath(`/admin/tickets/${ticket.id}`);
  return { ok: true };
}

// ── Customer-side new ticket ───────────────────────────────────────

const TICKET_CATEGORIES = [
  "hardware",
  "software",
  "network",
  "access",
  "other",
] as const;
const TICKET_PRIORITIES = ["low", "medium", "high", "critical"] as const;

// Customer-portal ticket creation. Priority is deliberately not asked
// for here — the Coordinator triages on review. Defaults to `medium`
// so the new ticket lands in a sane SLA bucket, and changes later
// trigger `recomputeSlaForTicket`. (Mirrors the same decision in the
// public `createTicket` schema.)
const customerCreateSchema = z.object({
  subject: z.string().trim().min(3).max(150),
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(TICKET_PRIORITIES).optional().default("medium"),
  description: z.string().trim().min(20).max(5000),
});

// `z.input<>` so callers can omit `priority` — see the matching note
// on `CreateTicketInput` in `src/app/actions/tickets.ts`.
export type CustomerCreateTicketInput = z.input<typeof customerCreateSchema>;

export type CustomerCreateTicketResult =
  | { ok: true; ticketNumber: string }
  | { ok: false; error: string };

/**
 * Authenticated portal ticket creation. The session is the source of truth
 * for `customerEmail`/`customerName` so a malicious payload can't spoof them.
 */
export async function customerCreateTicket(
  input: CustomerCreateTicketInput,
): Promise<CustomerCreateTicketResult> {
  const parsed = customerCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const data = parsed.data;

  const user = await requireSessionUser();
  if (!user.roleNames.has("Customer")) {
    throw new ForbiddenError();
  }

  const limit = await checkRateLimit("customerCreateTicket", user.id);
  if (!limit.allowed) {
    return { ok: false, error: "Daily ticket limit reached. Try again tomorrow." };
  }

  const [profile] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!profile) throw new NotFoundError();

  const stream = await classifyStream(profile.email);

  const ticketNumber = await generateTicketNumber();
  const createdAt = new Date();
  const { responseDueAt, resolutionDueAt } = await computeDueTimesForNewTicket(
    {
      createdAt,
      priority: data.priority as Priority,
    },
  );

  const [ticket] = await db
    .insert(tickets)
    .values({
      ticketNumber,
      subject: data.subject,
      description: data.description,
      category: data.category,
      priority: data.priority,
      status: "open",
      stream,
      origin: "portal",
      customerId: user.id,
      customerEmail: profile.email,
      customerName: profile.name,
      createdAt,
      responseDueAt,
      resolutionDueAt,
    })
    .returning({ id: tickets.id });

  await db.insert(messages).values({
    ticketId: ticket.id,
    authorId: user.id,
    authorEmail: profile.email,
    authorName: profile.name,
    authorType: "customer",
    body: data.description,
    channel: "portal",
  });

  await audit({
    actorId: user.id,
    action: "ticket.create",
    targetType: "ticket",
    targetId: ticketNumber,
    after: {
      ticketNumber,
      subject: data.subject,
      category: data.category,
      priority: data.priority,
      stream,
      origin: "portal",
    },
  });

  revalidatePath("/portal/tickets");
  revalidatePath("/admin/tickets");
  return { ok: true, ticketNumber };
}

// ── In-portal CSAT submission ─────────────────────────────────────
//
// Same outcome as `/csat/confirm` (the email-link route handler), but
// reachable from the customer's ticket detail page after a resolution
// — the customer says "yes this is fixed" / "no it's not" right inside
// the portal without going through the email. Doesn't need a signed
// token because the caller is the authenticated ticket owner; ownership
// is verified against `tickets.customer_id`.

const csatResponseSchema = z.enum(["satisfied", "unsatisfied"]);

export type CustomerCsatResult =
  | { ok: true; newStatus: "closed" | "open" | "in_progress" }
  | { ok: false; error: string };

export async function submitCsatFromPortal(
  ticketId: string,
  response: "satisfied" | "unsatisfied",
): Promise<CustomerCsatResult> {
  const parsedResponse = csatResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    return { ok: false, error: "Invalid response." };
  }

  const user = await requireSessionUser();
  if (!user.roleNames.has("Customer")) {
    throw new ForbiddenError();
  }

  const [ticket] = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      status: tickets.status,
      assignedToId: tickets.assignedToId,
      customerId: tickets.customerId,
      csatResponse: tickets.csatResponse,
      subject: tickets.subject,
    })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);

  if (!ticket || ticket.customerId !== user.id) {
    // Either no such ticket OR not the owner. Same opaque error so the
    // wrong-owner case isn't distinguishable from not-found.
    return { ok: false, error: "Ticket not found." };
  }
  if (ticket.csatResponse) {
    return { ok: false, error: "You've already given feedback on this ticket." };
  }
  if (ticket.status !== "resolved") {
    return {
      ok: false,
      error: "Feedback is only available on resolved tickets.",
    };
  }

  const now = new Date();
  let newStatus: "closed" | "open" | "in_progress";

  if (parsedResponse.data === "satisfied") {
    newStatus = "closed";
    await db
      .update(tickets)
      .set({
        csatResponse: "satisfied",
        csatRespondedAt: now,
        status: "closed",
        closedAt: now,
        updatedAt: now,
      })
      .where(eq(tickets.id, ticket.id));
    await audit({
      actorId: user.id,
      action: "ticket.csat.satisfied",
      targetType: "ticket",
      targetId: ticket.ticketNumber,
      before: { status: "resolved" },
      after: { status: "closed", csatResponse: "satisfied", source: "portal" },
    });
  } else {
    // Unsatisfied → reopen. If still assigned, go to in_progress;
    // otherwise back to open. Matches the email-link route handler.
    newStatus = ticket.assignedToId ? "in_progress" : "open";
    await db
      .update(tickets)
      .set({
        csatResponse: "unsatisfied",
        csatRespondedAt: now,
        status: newStatus,
        resolvedAt: null,
        reopenedCount: sql`${tickets.reopenedCount} + 1`,
        updatedAt: now,
      })
      .where(eq(tickets.id, ticket.id));
    await audit({
      actorId: user.id,
      action: "ticket.csat.unsatisfied",
      targetType: "ticket",
      targetId: ticket.ticketNumber,
      before: { status: "resolved" },
      after: {
        status: newStatus,
        csatResponse: "unsatisfied",
        source: "portal",
      },
    });

    // Best-effort notify the assigned tech that the customer reopened.
    if (ticket.assignedToId) {
      try {
        await inngest.send({
          name: "notification/dispatch",
          data: {
            type: "ticket.customer_replied",
            recipientUserIds: [ticket.assignedToId],
            inApp: {
              titleArgs: { ticketNumber: ticket.ticketNumber },
              bodyArgs: { customerName: "Customer" },
              linkUrl: `/admin/tickets/${ticket.id}`,
            },
          },
        });
      } catch (err) {
        console.error("[submitCsatFromPortal] dispatch failed:", err);
      }
    }
  }

  revalidatePath(`/portal/tickets/${ticket.ticketNumber}`);
  revalidatePath("/portal/tickets");
  revalidatePath(`/admin/tickets/${ticket.id}`);
  return { ok: true, newStatus };
}
