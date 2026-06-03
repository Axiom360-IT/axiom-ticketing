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
import { clientIp, getAppUrl } from "@/lib/request";
import { computeDueTimesForNewTicket, type Priority } from "@/lib/sla";
import { generateTicketNumber } from "@/lib/ticket-number";
import {
  resolveTicketOrgById,
  resolveTicketOrgForGuest,
} from "@/lib/tickets/org";
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
        | "invalid_password"
        | "rate_limited_email"
        | "rate_limited_ip"
        | "account_exists"
        | "signup_failed";
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
// Password is required at sign-up. Min length matches Better Auth's
// `emailAndPassword.minPasswordLength` (12).
const requiredPasswordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(200);

export async function requestSignUpMagicLink(
  name: string,
  email: string,
  phone: string | undefined,
  password: string,
  organization?: string,
): Promise<RequestSignUpResult> {
  const parsedName = nameSchema.safeParse(name);
  if (!parsedName.success) return { ok: false, error: "invalid_name" };
  const parsedEmail = emailSchema.safeParse(email);
  if (!parsedEmail.success) return { ok: false, error: "invalid_email" };
  const parsedPhone = phoneSchema.safeParse(phone ?? "");
  if (!parsedPhone.success) return { ok: false, error: "invalid_phone" };
  // Link the account to a registered org by EMAIL DOMAIN (the verifiable
  // signal); leaves it unset when the domain doesn't match — an admin can
  // link it later. A typed name alone never auto-links.
  const { organizationId } = await resolveTicketOrgForGuest(email, organization);
  // Empty string → null in the DB (no phone configured → no SMS).
  const normalizedPhone =
    parsedPhone.data && parsedPhone.data.length > 0 ? parsedPhone.data : null;
  const normalized = parsedEmail.data;

  const parsedPw = requiredPasswordSchema.safeParse(password);
  if (!parsedPw.success) return { ok: false, error: "invalid_password" };
  const normalizedPassword = parsedPw.data;

  const h = await headers();
  const ip = clientIp(h);

  const ipLimit = await checkRateLimit("magicLinkByIp", `magic:ip:${ip}`);
  if (!ipLimit.allowed) return { ok: false, error: "rate_limited_ip" };

  const emailLimit = await checkRateLimit(
    "magicLinkByEmail",
    `magic:email:${normalized}`,
  );
  if (!emailLimit.allowed) return { ok: false, error: "rate_limited_email" };

  // Create the account via Better Auth's email/password sign-up. With
  // `requireEmailVerification: true`, the user is NOT signed in here
  // — Better Auth fires `sendVerificationEmail` instead, and we
  // redirect them to a "check your inbox" page.
  //
  // If the email already exists, two cases:
  //   - Existing account is unverified → resend the verification link
  //     and report success so the user lands on the same "check your
  //     inbox" page. This is the recovery flow for users who lost or
  //     missed the first email. We do NOT overwrite the password here
  //     — that would let an attacker hijack any unverified email.
  //   - Existing account is verified → return `account_exists` so the
  //     form points them at sign-in.
  try {
    await auth.api.signUpEmail({
      body: {
        email: normalized,
        password: normalizedPassword,
        name: parsedName.data,
        ...(normalizedPhone ? { phone: normalizedPhone } : {}),
        ...(organizationId ? { organizationId } : {}),
      },
      headers: h,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : "";
    if (msg.includes("already") || msg.includes("exists")) {
      // Check if the existing account is verified. If not, re-send the
      // verification link as a recovery convenience.
      const [existing] = await db
        .select({ id: users.id, emailVerified: users.emailVerified })
        .from(users)
        .where(eq(users.email, normalized))
        .limit(1);
      if (existing && !existing.emailVerified) {
        try {
          await auth.api.sendVerificationEmail({
            body: {
              email: normalized,
              callbackURL: "/portal/tickets",
            },
            headers: h,
          });
        } catch (sendErr) {
          if (process.env.NODE_ENV !== "production") {
            console.warn("[signUp] re-send verification failed:", sendErr);
          }
        }
        // Return success so the form lands on the verify-sent page,
        // matching the happy-path UX.
        return { ok: true };
      }
      return { ok: false, error: "account_exists" };
    }
    if (process.env.NODE_ENV !== "production") {
      console.error("[signUp] signUpEmail failed:", err);
    }
    return { ok: false, error: "signup_failed" };
  }

  return { ok: true };
}

// ── Customer reply ─────────────────────────────────────────────────

const replySchema = z.object({
  body: z.string().trim().min(1, "Reply cannot be empty").max(10000),
  attachmentIds: z.array(z.string().uuid()).max(20).default([]),
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

  // Notify the assignee — or, if the ticket is still in triage with no
  // assignee, broadcast to Coordinators so the reply doesn't sit silently
  // until someone happens to look at the queue.
  try {
    const appUrl = getAppUrl();
    const ticketUrl = `${appUrl}/admin/tickets/${ticket.id}`;
    await inngest.send({
      name: "notification/dispatch",
      data: {
        type: "ticket.customer_replied",
        recipientUserIds: ticket.assignedToId ? [ticket.assignedToId] : [],
        recipientRoles: ticket.assignedToId ? undefined : ["Coordinator"],
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        email: {
          template: {
            template: "ticket_reply",
            data: {
              ticketNumber: ticket.ticketNumber,
              customerName: profile.name,
              subject: ticket.subject,
              agentName: profile.name,
              body: htmlToPlainText(cleanBody),
              trackingUrl: ticketUrl,
            },
          },
          ticketNumber: ticket.ticketNumber,
        },
        sms: {
          template: {
            template: "customer_replied",
            data: { ticketNumber: ticket.ticketNumber, ticketUrl },
          },
        },
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
  attachmentIds: z.array(z.string().uuid()).max(20).optional(),
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
 * Attachments uploaded via `guestGenerateUploadUrl` (same signed token)
 * are linked to the inserted message in the same transaction. Each
 * attachment row already has `ticket_id = ticket.id` set from the
 * upload step, so a malicious caller can't slip in foreign attachment
 * ids by guessing — the FK + ticket_id filter constrain it.
 */
export async function guestReply(input: {
  ticketNumber: string;
  token: string;
  body: string;
  attachmentIds?: string[];
}): Promise<GuestReplyResult> {
  const parsed = guestReplySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid reply",
    };
  }
  const { ticketNumber, token, body, attachmentIds = [] } = parsed.data;

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
      subject: tickets.subject,
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
    const [inserted] = await tx
      .insert(messages)
      .values({
        ticketId: ticket.id,
        authorId: null, // guest — not yet a registered user
        authorEmail: verifiedEmail,
        authorName: ticket.customerName,
        authorType: "customer",
        body: cleanBody,
        bodyFormat: "html",
        channel: "portal",
      })
      .returning({ id: messages.id });

    if (attachmentIds.length > 0) {
      // Link only attachments that belong to this ticket (FK + filter)
      // and have no message yet. A leaked token can't pull in someone
      // else's attachments because they're scoped by ticket_id.
      await tx
        .update(attachments)
        .set({ messageId: inserted.id })
        .where(
          and(
            inArray(attachments.id, attachmentIds),
            eq(attachments.ticketId, ticket.id),
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
    actorId: null,
    action: "ticket.customer_reply",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    after: { length: body.length, channel: "portal", actor_kind: "guest" },
    ipAddress: ip ?? undefined,
  });

  try {
    const appUrl = getAppUrl();
    const ticketUrl = `${appUrl}/admin/tickets/${ticket.id}`;
    await inngest.send({
      name: "notification/dispatch",
      data: {
        type: "ticket.customer_replied",
        recipientUserIds: ticket.assignedToId ? [ticket.assignedToId] : [],
        recipientRoles: ticket.assignedToId ? undefined : ["Coordinator"],
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        email: {
          template: {
            template: "ticket_reply",
            data: {
              ticketNumber: ticket.ticketNumber,
              customerName: ticket.customerName,
              subject: ticket.subject,
              agentName: ticket.customerName,
              body: htmlToPlainText(cleanBody),
              trackingUrl: ticketUrl,
            },
          },
          ticketNumber: ticket.ticketNumber,
        },
        sms: {
          template: {
            template: "customer_replied",
            data: { ticketNumber: ticket.ticketNumber, ticketUrl },
          },
        },
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

  revalidatePath(`/portal/guest/tickets/${ticket.ticketNumber}`);
  revalidatePath(`/admin/tickets/${ticket.id}`);
  return { ok: true };
}

// ── Customer-side new ticket ───────────────────────────────────────

const TICKET_PRIORITIES = ["low", "medium", "high", "critical"] as const;

// Customer-portal ticket creation. Priority is deliberately not asked
// for here — the Coordinator triages on review. Defaults to `medium`
// so the new ticket lands in a sane SLA bucket, and changes later
// trigger `recomputeSlaForTicket`. (Mirrors the same decision in the
// public `createTicket` schema.)
const customerCreateSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(3, "Subject must be at least 3 characters")
    .max(150, "Subject must be at most 150 characters"),
  // Category removed from the customer form (Meeting-2, CR-03); defaults to
  // "other" server-side. The org comes from the customer's account, not the
  // form, so there is no org field here.
  priority: z.enum(TICKET_PRIORITIES).optional().default("medium"),
  // Description optional (Meeting-2, CR-03/Q2).
  description: z
    .string()
    .trim()
    .max(5000, "Description must be at most 5000 characters")
    .optional()
    .default(""),
  // Optional ID of a draft ticket created via `prepareCustomerTicketDraft`.
  // When present, the action UPDATES the draft to `open` instead of
  // inserting a new ticket — so pre-uploaded attachments already linked
  // to the draft come along into the live ticket.
  draftTicketId: z.string().uuid().optional(),
});

// ── Pre-submission draft ticket ──────────────────────────────────
//
// Customers want to attach a screenshot before the ticket exists. Solved
// by creating a `status='draft'` ticket row up-front so its `id` exists
// for the attachment FK, then promoting it to `open` when the form is
// submitted. Drafts are filtered out of every customer/admin query
// (see `ticketsVisibilityCondition` + `listMyTickets`), and a cron
// sweeps stale drafts every 24h.

export type PrepareCustomerDraftResult =
  | { ok: true; draftTicketId: string }
  | { ok: false; error: string };

export async function prepareCustomerTicketDraft(): Promise<PrepareCustomerDraftResult> {
  const user = await requireSessionUser();
  if (!user.roleNames.has("Customer")) {
    throw new ForbiddenError();
  }

  // Note: no rate-limit check here. Drafts only exist so the customer
  // can upload attachments BEFORE submitting. They get a real ticket
  // number but never become visible until promoted by
  // `customerCreateTicket`, which IS rate-limited. Abandoned drafts are
  // swept by the `cleanup-stale-drafts` cron after 24h. Counting drafts
  // against the daily ticket cap would lock out users who re-pick files
  // a few times before submitting.

  const [profile] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!profile) throw new NotFoundError();

  const ticketNumber = await generateTicketNumber();
  const stream = await classifyStream(profile.email);
  const createdAt = new Date();
  const { responseDueAt, resolutionDueAt } = await computeDueTimesForNewTicket(
    { createdAt, priority: "medium" },
  );

  const [draft] = await db
    .insert(tickets)
    .values({
      ticketNumber,
      subject: "(draft)",
      description: "",
      category: "other",
      priority: "medium",
      status: "draft",
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

  return { ok: true, draftTicketId: draft.id };
}

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
    .select({
      name: users.name,
      email: users.email,
      organizationId: users.organizationId,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!profile) throw new NotFoundError();

  const stream = await classifyStream(profile.email);
  // The customer's organization comes from their account (CR-02/06/07).
  const org = await resolveTicketOrgById(profile.organizationId);
  const createdAt = new Date();
  const { responseDueAt, resolutionDueAt } = await computeDueTimesForNewTicket(
    {
      createdAt,
      priority: data.priority as Priority,
    },
  );

  let ticketId: string;
  let ticketNumber: string;

  if (data.draftTicketId) {
    // Promote the draft. Verify ownership first so a leaked draft id
    // can't be used by someone else.
    const [draft] = await db
      .select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        customerId: tickets.customerId,
        status: tickets.status,
      })
      .from(tickets)
      .where(eq(tickets.id, data.draftTicketId))
      .limit(1);
    if (!draft || draft.customerId !== user.id || draft.status !== "draft") {
      return { ok: false, error: "Draft ticket is invalid or expired." };
    }

    ticketId = draft.id;
    // Regenerate the number with the org prefix now the org is known (CR-07).
    ticketNumber = await generateTicketNumber(org.prefix, org.timeZone);

    await transactional(async (tx) => {
      await tx
        .update(tickets)
        .set({
          ticketNumber,
          organizationId: org.organizationId,
          orgMatchStatus: org.matchStatus,
          subject: data.subject,
          description: data.description,
          category: "other",
          priority: data.priority,
          status: "open",
          createdAt,
          responseDueAt,
          resolutionDueAt,
          updatedAt: createdAt,
        })
        .where(eq(tickets.id, draft.id));

      const [inserted] = await tx
        .insert(messages)
        .values({
          ticketId,
          authorId: user.id,
          authorEmail: profile.email,
          authorName: profile.name,
          authorType: "customer",
          body: data.description,
          channel: "portal",
        })
        .returning({ id: messages.id });

      // Pre-uploaded attachments live on this draft ticket with
      // messageId=NULL; bind them to the freshly-inserted initial
      // message so they render inline in the thread.
      await tx
        .update(attachments)
        .set({ messageId: inserted.id })
        .where(
          and(
            eq(attachments.ticketId, ticketId),
            isNull(attachments.messageId),
            ne(attachments.scanStatus, "quarantined"),
          ),
        );
    });
  } else {
    ticketNumber = await generateTicketNumber(org.prefix, org.timeZone);
    const [ticket] = await db
      .insert(tickets)
      .values({
        ticketNumber,
        organizationId: org.organizationId,
        orgMatchStatus: org.matchStatus,
        subject: data.subject,
        description: data.description,
        category: "other",
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
    ticketId = ticket.id;

    await db.insert(messages).values({
      ticketId,
      authorId: user.id,
      authorEmail: profile.email,
      authorName: profile.name,
      authorType: "customer",
      body: data.description,
      channel: "portal",
    });
  }

  await audit({
    actorId: user.id,
    action: "ticket.create",
    targetType: "ticket",
    targetId: ticketNumber,
    after: {
      ticketNumber,
      subject: data.subject,
      organizationId: org.organizationId,
      category: "other",
      priority: data.priority,
      stream,
      origin: "portal",
      promotedFromDraft: !!data.draftTicketId,
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

const csatSubmitSchema = z.object({
  response: z.enum(["satisfied", "unsatisfied"]),
  // Optional explanation when the customer says "not fixed". Posted as a
  // message on the ticket so the assigned tech has the customer's words
  // to act on (not just "reopened, no context").
  comment: z.string().trim().max(2000).optional(),
});

export type CustomerCsatResult =
  | { ok: true; newStatus: "closed" | "open" | "in_progress" }
  | { ok: false; error: string };

export async function submitCsatFromPortal(
  ticketId: string,
  response: "satisfied" | "unsatisfied",
  comment?: string,
): Promise<CustomerCsatResult> {
  const parsed = csatSubmitSchema.safeParse({ response, comment });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid response.",
    };
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
      customerName: tickets.customerName,
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

  const [profile] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!profile) throw new NotFoundError();

  const now = new Date();
  let newStatus: "closed" | "open" | "in_progress";

  if (parsed.data.response === "satisfied") {
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

    const trimmedComment = parsed.data.comment?.trim() ?? "";

    await transactional(async (tx) => {
      await tx
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

      // Persist the customer's "still not fixed" comment as a real
      // message on the thread so the assigned tech sees it in context.
      // Stored as plain text — the textarea is a single-line input, not
      // the rich composer.
      if (trimmedComment.length > 0) {
        await tx.insert(messages).values({
          ticketId: ticket.id,
          authorId: user.id,
          authorEmail: profile.email,
          authorName: profile.name,
          authorType: "customer",
          body: trimmedComment,
          bodyFormat: "text",
          channel: "portal",
        });
      }
    });

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
        commentLength: trimmedComment.length,
      },
    });

    // Notify the assigned tech + Coordinator role that the customer
    // pushed back. Goes through the dispatcher so per-user
    // email/SMS/bell prefs are honored.
    try {
      const appUrl = getAppUrl();
      const adminTicketUrl = `${appUrl}/admin/tickets/${ticket.id}`;
      await inngest.send({
        name: "notification/dispatch",
        data: {
          type: "ticket.csat_unsatisfied",
          recipientUserIds: ticket.assignedToId ? [ticket.assignedToId] : [],
          recipientRoles: ["Coordinator"],
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          email: {
            template: {
              template: "csat_unsatisfied_staff",
              data: {
                ticketNumber: ticket.ticketNumber,
                subject: ticket.subject,
                customerName: profile.name,
                ticketUrl: adminTicketUrl,
              },
            },
            ticketNumber: ticket.ticketNumber,
          },
          sms: {
            template: {
              template: "csat_unsatisfied_staff",
              data: {
                ticketNumber: ticket.ticketNumber,
                ticketUrl: adminTicketUrl,
              },
            },
          },
          inApp: {
            titleArgs: { ticketNumber: ticket.ticketNumber },
            bodyArgs: { customerName: profile.name },
            linkUrl: `/admin/tickets/${ticket.id}`,
          },
        },
      });
    } catch (err) {
      console.error("[submitCsatFromPortal] dispatch failed:", err);
    }
  }

  revalidatePath(`/portal/tickets/${ticket.ticketNumber}`);
  revalidatePath("/portal/tickets");
  revalidatePath(`/admin/tickets/${ticket.id}`);
  return { ok: true, newStatus };
}
