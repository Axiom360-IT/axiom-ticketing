"use server";

import {
  type SQL,
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can, isStrictTechnician } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { requireSessionUser } from "@/lib/auth/session";
import { db, transactional } from "@/lib/db/client";
import { attachments } from "@/lib/db/schema/attachments";
import { users } from "@/lib/db/schema/auth";
import { messages } from "@/lib/db/schema/messages";
import { ticketAssignees } from "@/lib/db/schema/ticket-assignees";
import { tickets } from "@/lib/db/schema/tickets";
import { workLogs } from "@/lib/db/schema/work-logs";
import { sendEmail } from "@/lib/email/send";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { checkRateLimit, enforceUserRateLimit } from "@/lib/ratelimit";
import { clientIp, getAppUrl } from "@/lib/request";
import { loadTicketScope } from "@/lib/tickets/load";
import { classifyStream } from "@/lib/tickets/stream";
import {
  emailDomain,
  resolveTicketOrgById,
  resolveTicketOrgForGuest,
  ticketsShareOrg,
} from "@/lib/tickets/org";
import { listActiveParticipants } from "@/lib/tickets/participants";
import { syncMonthlyPlanDeduction } from "@/lib/tickets/billing";
import { notifyBalanceChanged } from "@/lib/billing/events";
import {
  htmlToPlainText,
  sanitizeMessageHtml,
} from "@/lib/messages/sanitize";
import { inngest } from "@/inngest/client";
import { dispatchTicketCreated } from "@/lib/notifications/dispatch-ticket-created";
import { computeDueTimesForNewTicket, type Priority } from "@/lib/sla";
import { generateTicketNumber } from "@/lib/ticket-number";
import {
  guestTicketUrl,
  signCsatToken,
  signDraftUploadToken,
  ticketTrackingUrl,
  verifyDraftUploadToken,
} from "@/lib/tokens";
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

// Module-private — Next.js 16 forbids non-async-function exports from
// "use server" files. Schemas + types stay internal; callers pass plain
// objects to the actions and the schema validates server-side.
//
// Priority is deliberately NOT required from customers. Letting end users
// self-assign priority is the fastest known way to make every ticket
// "critical" within weeks — the Coordinator triages priority on review.
// Defaulting to `medium` here lands new tickets in a reasonable SLA bucket;
// when a coordinator later changes the priority, `recomputeSlaForTicket`
// re-stamps the due-time columns. Internal-staff actions that genuinely
// know the priority up front (`createTicketOnBehalf`) still take it
// explicitly — that schema is below and unchanged.
const createTicketSchema = z.object({
  customerName: z.string().trim().min(1, "Name is required").max(120),
  customerEmail: z.string().trim().toLowerCase().email("Enter a valid email"),
  subject: z
    .string()
    .trim()
    .min(3, "Subject must be at least 3 characters")
    .max(150, "Subject must be at most 150 characters"),
  // Organization is no longer typed by the submitter — it's resolved from the
  // email domain (Org Management 1.4). Kept optional for any legacy/API caller;
  // when absent the resolver falls back to domain matching only.
  organization: z
    .string()
    .trim()
    .max(160, "Organization must be at most 160 characters")
    .optional(),
  priority: z.enum(TICKET_PRIORITIES).optional().default("medium"),
  // Description is optional (Meeting-2, CR-03/Q2 — the boss chose to keep it
  // optional and observe usage before forcing it).
  description: z
    .string()
    .trim()
    .max(5000, "Description must be at most 5000 characters")
    .optional()
    .default(""),
  // Anti-abuse — invisible to humans
  turnstileToken: z.string().optional(),
  honeypot: z.string().optional(),
  // Optional pre-created draft ticket id + signed upload token. When
  // present, the action UPDATES the draft to `open` instead of inserting
  // a new ticket — so pre-uploaded attachments stay linked. The token
  // verifies the draft was actually created by this flow (so a caller
  // can't promote an arbitrary draft they don't own).
  draftTicketId: z.string().uuid().optional(),
  draftUploadToken: z.string().min(1).max(2000).optional(),
});

// `z.input` rather than `z.infer` so callers can OMIT `priority` —
// the schema's `.optional().default("medium")` makes priority optional
// in the input but defaulted (non-optional) in the output. `z.input<>`
// gives us the caller-facing shape; the action body uses `parsed.data`
// which is the output type (always has priority defined).
type CreateTicketInput = z.input<typeof createTicketSchema>;

type CreateTicketResult =
  | { ok: true; ticketNumber: string }
  | { ok: false; error: string };

// ── Pre-submission draft ticket (guest) ──────────────────────────────
//
// Anonymous customers want to attach a screenshot before they've typed
// out their description. Same problem as the authed path
// (`prepareCustomerTicketDraft`), different security model: no session.
// We require name + email + a successful captcha, rate-limit by IP and
// email exactly like the real submission, then create a `status='draft'`
// ticket. Returns the draft id + a signed `uploadToken` that the client
// uses to authorize subsequent uploads to that specific draft.

const prepareGuestDraftSchema = z.object({
  customerName: z.string().trim().min(1).max(120),
  customerEmail: z.string().trim().toLowerCase().email(),
  turnstileToken: z.string().optional(),
});

export type PrepareGuestDraftResult =
  | {
      ok: true;
      draftTicketId: string;
      uploadToken: string;
    }
  | { ok: false; error: string };

export async function prepareGuestTicketDraft(
  input: z.input<typeof prepareGuestDraftSchema>,
): Promise<PrepareGuestDraftResult> {
  const parsed = prepareGuestDraftSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const data = parsed.data;

  const h = await headers();
  const ip = clientIp(h);

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
      error: "Too many submissions from this email today. Try again tomorrow.",
    };
  }

  const turnstile = await verifyTurnstile(data.turnstileToken, ip);
  if (!turnstile.success) {
    return {
      ok: false,
      error: "Captcha verification failed. Please refresh the page and try again.",
    };
  }

  const ticketNumber = await generateTicketNumber();
  const stream = await classifyStream(data.customerEmail);
  const createdAt = new Date();
  const { responseDueAt, resolutionDueAt } = await computeDueTimesForNewTicket({
    createdAt,
    priority: "medium",
  });

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
      origin: "web_form",
      customerEmail: data.customerEmail,
      customerName: data.customerName,
      createdAt,
      responseDueAt,
      resolutionDueAt,
    })
    .returning({ id: tickets.id });

  const uploadToken = signDraftUploadToken(draft.id);
  return { ok: true, draftTicketId: draft.id, uploadToken };
}

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
  const ip = clientIp(h);
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

  // 6. Determine stream (internal vs external). `classifyStream` returns
  // "internal" if the submitter's email maps to an active staff user;
  // otherwise it falls back to the `internal_email_domains` allowlist.
  const stream = await classifyStream(data.customerEmail);

  // 6b. Resolve the organization. We auto-link ONLY on an email-domain match
  // (the verifiable signal); a typed company that doesn't match is recorded as
  // `unverified` for coordinator triage and never silently drives billing.
  const org = await resolveTicketOrgForGuest(
    data.customerEmail,
    data.organization,
  );
  const customerCompany = data.organization?.trim() || null;

  // 7. Compute SLA deadlines (number is generated per-branch below).
  const createdAt = new Date();
  const { responseDueAt, resolutionDueAt } = await computeDueTimesForNewTicket({
    createdAt,
    priority: data.priority as Priority,
  });

  let ticketNumber: string;
  let ticketId: string;

  // 8. Either promote a draft (if the client uploaded attachments before
  // submitting) or insert a fresh ticket.
  if (data.draftTicketId && data.draftUploadToken) {
    if (!verifyDraftUploadToken(data.draftUploadToken, data.draftTicketId)) {
      return { ok: false, error: "Draft ticket session is invalid or expired." };
    }
    const [draft] = await db
      .select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        customerEmail: tickets.customerEmail,
        status: tickets.status,
      })
      .from(tickets)
      .where(eq(tickets.id, data.draftTicketId))
      .limit(1);
    if (
      !draft ||
      draft.status !== "draft" ||
      draft.customerEmail !== data.customerEmail
    ) {
      return { ok: false, error: "Draft ticket session is invalid or expired." };
    }
    // The draft's number was generated before the org was known (placeholder
    // "AX" prefix). Regenerate it now with the resolved org prefix so the
    // final number reflects the company (CR-07). Nothing references the draft
    // number before promotion (attachments link by ticket id, not number).
    ticketNumber = await generateTicketNumber(org.prefix, org.timeZone);
    ticketId = draft.id;

    await transactional(async (tx) => {
      await tx
        .update(tickets)
        .set({
          ticketNumber,
          organizationId: org.organizationId,
          customerCompany,
          orgMatchStatus: org.matchStatus,
          subject: data.subject,
          description: data.description,
          category: "other",
          priority: data.priority,
          status: "open",
          stream,
          createdAt,
          responseDueAt,
          resolutionDueAt,
          customerName: data.customerName,
          updatedAt: createdAt,
        })
        .where(eq(tickets.id, draft.id));

      const [inserted] = await tx
        .insert(messages)
        .values({
          ticketId: draft.id,
          authorEmail: data.customerEmail,
          authorName: data.customerName,
          authorType: "customer",
          body: data.description,
          channel: "portal",
        })
        .returning({ id: messages.id });

      // Link pre-uploaded attachments (uploaded via the guest draft
      // flow) to the initial message so they render in the thread.
      await tx
        .update(attachments)
        .set({ messageId: inserted.id })
        .where(
          and(
            eq(attachments.ticketId, draft.id),
            isNull(attachments.messageId),
            ne(attachments.scanStatus, "quarantined"),
          ),
        );
    });
  } else {
    ticketNumber = await generateTicketNumber(org.prefix, org.timeZone);
    ticketId = await transactional(async (tx) => {
      const [ticket] = await tx
        .insert(tickets)
        .values({
          ticketNumber,
          organizationId: org.organizationId,
          customerCompany,
          orgMatchStatus: org.matchStatus,
          subject: data.subject,
          description: data.description,
          category: "other",
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

      await tx.insert(messages).values({
        ticketId: ticket.id,
        authorEmail: data.customerEmail,
        authorName: data.customerName,
        authorType: "customer",
        body: data.description,
        channel: "portal",
      });
      return ticket.id;
    });
  }

  // 9. Audit log
  await audit({
    actorId: null,
    action: "ticket.create",
    targetType: "ticket",
    targetId: ticketNumber,
    after: {
      ticketNumber,
      subject: data.subject,
      organization: data.organization,
      organizationId: org.organizationId,
      category: "other",
      priority: data.priority,
      stream,
      origin: "web_form",
      promotedFromDraft: !!data.draftTicketId,
    },
    ipAddress: ip,
    userAgent,
  });

  // 10. Send confirmation email (inline for now; Inngest fan-out comes later)
  try {
    const appUrl = getAppUrl();
    const trackingUrl = guestTicketUrl(appUrl, ticketNumber, data.customerEmail);

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

  // 11. Alert staff (Coordinators / IT Directors / Super Admins) that a new
  // ticket needs triage/assignment. Best-effort — never fail the submission.
  try {
    await dispatchTicketCreated({
      ticketId,
      ticketNumber,
      customerName: data.customerName,
      subject: data.subject,
      appUrl: getAppUrl(),
    });
  } catch (err) {
    console.error("[createTicket] new-ticket dispatch failed:", err);
  }

  return { ok: true, ticketNumber };
}

// ── Coordinator: create on behalf of a customer ──────────────────────

const createOnBehalfSchema = z.object({
  customerName: z.string().trim().min(1, "Name is required").max(120),
  customerEmail: z.string().trim().toLowerCase().email("Enter a valid email"),
  subject: z
    .string()
    .trim()
    .min(3, "Subject must be at least 3 characters")
    .max(150, "Subject must be at most 150 characters"),
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(TICKET_PRIORITIES),
  // Staff pick the organization from a dropdown of registered orgs (CR-02).
  organizationId: z.string().uuid().optional(),
  description: z
    .string()
    .trim()
    .min(20, "Description must be at least 20 characters")
    .max(5000),
});

type CreateOnBehalfInput = z.infer<typeof createOnBehalfSchema>;
type CreateOnBehalfResult =
  | { ok: true; ticketNumber: string }
  | { ok: false; error: string };

export async function createTicketOnBehalf(
  input: CreateOnBehalfInput,
): Promise<CreateOnBehalfResult> {
  const user = await requireSessionUser();
  await enforceUserRateLimit("authCreateTicket", user.id);
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

  const stream = await classifyStream(data.customerEmail);
  const org = await resolveTicketOrgById(data.organizationId ?? null);
  // A staff member explicitly picked the org from the registry, so it's a
  // confirmed link ("staff") rather than the "account" default the resolver
  // returns for the customer-self path.
  const orgMatchStatus = org.organizationId ? "staff" : "none";

  const ticketNumber = await generateTicketNumber(org.prefix, org.timeZone);
  const createdAt = new Date();
  const { responseDueAt, resolutionDueAt } = await computeDueTimesForNewTicket({
    createdAt,
    priority: data.priority as Priority,
  });

  const ticketId = await transactional(async (tx) => {
    const [ticket] = await tx
      .insert(tickets)
      .values({
        ticketNumber,
        organizationId: org.organizationId,
        orgMatchStatus,
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
    return ticket.id;
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
    const appUrl = getAppUrl();
    const trackingUrl = guestTicketUrl(appUrl, ticketNumber, data.customerEmail);
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

  // Alert staff (Coordinators / IT Directors / Super Admins) that a new ticket
  // exists — fired for on-behalf creations too. Best-effort.
  try {
    await dispatchTicketCreated({
      ticketId,
      ticketNumber,
      customerName: data.customerName,
      subject: data.subject,
      appUrl: getAppUrl(),
    });
  } catch (err) {
    console.error("[createTicketOnBehalf] new-ticket dispatch failed:", err);
  }

  revalidatePath("/admin/tickets");
  return { ok: true, ticketNumber };
}

// ── Assignment ──────────────────────────────────────────────────────

export async function assignTicket(
  ticketId: string,
  techId: string,
): Promise<{ retainsView: boolean; assigneeName: string }> {
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

  // Both writes in one transaction so the invariant "the primary technician is
  // NEVER also a merge co-assignee" is crash-safe: set the primary AND drop any
  // co-assignee row for that same tech (on a merged ticket they may have been a
  // co-assignee) atomically, so they're never represented — or removable —
  // twice. On a non-merged ticket the DELETE is a harmless no-op.
  await transactional(async (tx) => {
    await tx
      .update(tickets)
      .set({
        assignedToId: techId,
        assignedAt: new Date(),
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(tickets.id, ticketId));
    await tx
      .delete(ticketAssignees)
      .where(
        and(
          eq(ticketAssignees.ticketId, ticketId),
          eq(ticketAssignees.userId, techId),
        ),
      );
  });

  await audit({
    actorId: user.id,
    action: "ticket.assign",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    before,
    after: { assignedToId: techId, status: newStatus },
  });

  // Notify customer — through the dispatcher so the customer's
  // notification preferences (email + SMS toggles per event) and the
  // bell icon are honored. Guest tickets (no `customer_id`) take the
  // direct-email fallback because they have no preferences row, no SMS
  // phone, and no in-app inbox.
  try {
    const appUrl = getAppUrl();
    // `ticketTrackingUrl` returns the portal URL for registered
    // customers (so they land in their normal inbox view) and falls
    // back to the token-signed guest URL only for tickets with no
    // `customerId`.
    const trackingUrl = ticketTrackingUrl({
      appUrl,
      ticketNumber: ticket.ticketNumber,
      customerEmail: ticket.customerEmail,
      customerId: ticket.customerId,
    });
    if (ticket.customerId) {
      await inngest.send({
        name: "notification/dispatch",
        data: {
          // Customer-facing assignment event — NEVER `ticket.assigned`, which
          // renders the tech-oriented "assigned to you" copy in the bell
          // (req 6.1). This one names the technician (req 6.2).
          type: "ticket.assigned_customer",
          recipientUserIds: [ticket.customerId],
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          email: {
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
          },
          sms: {
            template: {
              template: "ticket_assigned_customer",
              data: { ticketNumber: ticket.ticketNumber, ticketUrl: trackingUrl },
            },
          },
          inApp: {
            titleArgs: { ticketNumber: ticket.ticketNumber },
            bodyArgs: { technicianName: tech.name },
            linkUrl: `/portal/tickets/${ticket.ticketNumber}`,
          },
        },
      });
    } else {
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
    }
  } catch (err) {
    console.error("[assignTicket] customer notification failed:", err);
  }

  // Notify the assigned tech via the M11 dispatch fan-out — emits ONE
  // event; the dispatcher gates email/sms by the user's preferences and
  // always inserts an in-app notification.
  try {
    const appUrl = getAppUrl();
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

  // Req 3.2 — On a TRUE reassignment (the ticket already had a DIFFERENT
  // technician), notify every Super Admin through all three channels (email +
  // SMS + in-app). Skipped for the first assignment (no prior tech) and for a
  // no-op re-assign to the same tech. Best-effort: a notification failure must
  // never roll back the reassignment.
  if (before.assignedToId && before.assignedToId !== techId) {
    try {
      const [prevTech] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, before.assignedToId))
        .limit(1);
      const [actor] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      const appUrl = getAppUrl();
      const ticketUrl = `${appUrl}/admin/tickets/${ticket.id}`;
      const fromTechName = prevTech?.name ?? "Unassigned";
      const toTechName = tech.name;
      const actorName = actor?.name ?? "A technician";
      await inngest.send({
        name: "notification/dispatch",
        data: {
          type: "ticket.reassigned",
          recipientRoles: ["Super Admin"],
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          email: {
            template: {
              template: "ticket_reassigned",
              data: {
                ticketNumber: ticket.ticketNumber,
                subject: ticket.subject,
                fromTechName,
                toTechName,
                actorName,
                customerName: ticket.customerName,
                ticketUrl,
              },
            },
            ticketNumber: ticket.ticketNumber,
          },
          sms: {
            template: {
              template: "ticket_reassigned",
              data: { ticketNumber: ticket.ticketNumber, ticketUrl },
            },
          },
          inApp: {
            titleArgs: { ticketNumber: ticket.ticketNumber },
            bodyArgs: { fromTechName, toTechName },
            linkUrl: `/admin/tickets/${ticket.id}`,
          },
        },
      });
    } catch (err) {
      console.error("[assignTicket] reassignment dispatch failed:", err);
    }
  }

  revalidatePath("/admin/tickets");
  revalidatePath(`/admin/tickets/${ticketId}`);

  // Tell the caller whether THEY can still see this ticket afterwards, so the
  // UI can redirect cleanly instead of bouncing through a 404. A strict tech
  // who reassigned the ticket away keeps view access only if they remain a
  // collaborator or have logged work on it (read-only carry-over); everyone
  // else (elevated roles, or assigning to oneself) retains access.
  let retainsView = true;
  if (isStrictTechnician(user) && techId !== user.id) {
    const [stillCollaborator] = await db
      .select({ userId: ticketAssignees.userId })
      .from(ticketAssignees)
      .where(
        and(
          eq(ticketAssignees.ticketId, ticket.id),
          eq(ticketAssignees.userId, user.id),
        ),
      )
      .limit(1);
    if (stillCollaborator) {
      retainsView = true;
    } else {
      const [hasWorklog] = await db
        .select({ id: workLogs.id })
        .from(workLogs)
        .where(
          and(
            eq(workLogs.ticketId, ticket.id),
            eq(workLogs.technicianId, user.id),
          ),
        )
        .limit(1);
      retainsView = Boolean(hasWorklog);
    }
  }

  return { retainsView, assigneeName: tech.name };
}

// ── Soft delete ─────────────────────────────────────────────────────
// Sets `deletedAt` + `deletedById`. The row stays in the DB so message
// history, attachments, and audit references remain intact (FKs into
// tickets are `onDelete: "restrict"`). Default visibility scope hides
// soft-deleted rows from all lists.

type DeleteTicketResult =
  | { ok: true }
  | { ok: false; error: string };

export async function deleteTicket(
  ticketId: string,
): Promise<DeleteTicketResult> {
  const user = await requireSessionUser();
  const ticket = await loadTicketScope(ticketId);
  if (!ticket) throw new NotFoundError();

  if (
    !(await can(
      user,
      "tickets.delete",
      { type: "ticket", ticket },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  if (ticket.deletedAt) {
    return { ok: false, error: "Ticket is already deleted." };
  }

  const now = new Date();
  await db
    .update(tickets)
    .set({ deletedAt: now, deletedById: user.id, updatedAt: now })
    .where(eq(tickets.id, ticketId));

  await audit({
    actorId: user.id,
    action: "ticket.delete",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    before: { deletedAt: null },
    after: { deletedAt: now.toISOString() },
  });

  revalidatePath("/admin/tickets");
  revalidatePath(`/admin/tickets/${ticketId}`);
  return { ok: true };
}

// ── Merge two tickets ───────────────────────────────────────────────
// When the same customer files the same issue twice (common — email
// then portal, or follow-up email instead of a reply), an admin can
// merge ticket B into ticket A. All of B's messages and attachments
// move to A; B is closed and marked `duplicate_of_id = A.id`; viewing
// B in the future shows a banner linking to A.
//
// Authorization: gated on the dedicated `tickets.merge` permission, granted
// to Super Admin only (req §4), so it's decoupled from `tickets.delete`. Also
// carries BOTH source + target technicians onto the surviving ticket (req 4.4)
// and reparents the source's worklogs.

type MergeTicketsResult =
  | { ok: true; targetTicketNumber: string }
  | { ok: false; error: string };

export async function mergeTickets(
  sourceId: string,
  targetTicketNumberOrId: string,
): Promise<MergeTicketsResult> {
  const user = await requireSessionUser();
  const source = await loadTicketScope(sourceId);
  if (!source) throw new NotFoundError();
  if (
    !(await can(
      user,
      "tickets.merge",
      { type: "ticket", ticket: source },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  if (source.deletedAt) {
    return { ok: false, error: "Source ticket has been deleted." };
  }

  // Resolve the target — caller can pass either a ticket UUID (the dropdown
  // path) or a ticket number (AX-XXXX). Accepting both keeps the action robust.
  const normalized = targetTicketNumberOrId.trim();
  if (!normalized) {
    return { ok: false, error: "Pick a target ticket to merge into." };
  }
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    normalized,
  );
  const [target] = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      status: tickets.status,
      duplicateOfId: tickets.duplicateOfId,
      deletedAt: tickets.deletedAt,
      assignedToId: tickets.assignedToId,
      organizationId: tickets.organizationId,
      customerEmail: tickets.customerEmail,
    })
    .from(tickets)
    .where(
      isUuid
        ? eq(tickets.id, normalized)
        : eq(tickets.ticketNumber, normalized.toUpperCase()),
    )
    .limit(1);

  if (!target) {
    return { ok: false, error: "Target ticket not found." };
  }
  if (target.id === source.id) {
    return { ok: false, error: "Can't merge a ticket into itself." };
  }
  if (target.deletedAt) {
    return { ok: false, error: "Target ticket has been deleted." };
  }
  if (target.duplicateOfId) {
    return {
      ok: false,
      error: `Target ${target.ticketNumber} is already a duplicate of another ticket. Merge into the canonical ticket instead.`,
    };
  }
  if (source.duplicateOfId) {
    return { ok: false, error: "Source is already merged." };
  }
  if (target.status === "closed" || target.status === "resolved") {
    return {
      ok: false,
      error: `Target ${target.ticketNumber} is ${target.status} — merging would bury the source's history where it won't be triaged. Reopen the target first.`,
    };
  }

  // Req 4.3 — only same-organization tickets may merge (defense-in-depth; the
  // dropdown already filters to these). loadTicketScope omits organizationId,
  // so fetch the source's here.
  const [sourceOrgRow] = await db
    .select({ organizationId: tickets.organizationId })
    .from(tickets)
    .where(eq(tickets.id, source.id))
    .limit(1);
  const sourceForOrg = {
    organizationId: sourceOrgRow?.organizationId ?? null,
    customerEmail: source.customerEmail,
  };
  if (!ticketsShareOrg(sourceForOrg, target)) {
    return {
      ok: false,
      error: `${target.ticketNumber} belongs to a different organization. You can only merge tickets from the same organization.`,
    };
  }

  // Look up the actor's display name + email for the merge-announcement
  // system message. Fall back gracefully if the row is unexpectedly
  // missing so the merge transaction itself can't fail on display data.
  const [actor] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  const actorName = actor?.name ?? "Admin";
  const actorEmail = actor?.email ?? "system@local";

  const now = new Date();
  // Req 4.4 — carry BOTH technicians onto the merged ticket. The target keeps
  // its own tech as primary (Q2); the source's tech rides along as a co-assignee
  // (the one sanctioned exception to single-technician, req 3.1). If the target
  // had no tech, the source's becomes the sole primary instead.
  const sourceTech = source.assignedToId;
  const targetTech = target.assignedToId;
  const promoteSourceTechToPrimary = Boolean(
    sourceTech && !targetTech && sourceTech !== targetTech,
  );
  const addSourceTechAsCoAssignee = Boolean(
    sourceTech && targetTech && sourceTech !== targetTech,
  );

  const mergeAffectedOrgIds = await transactional(async (tx) => {
    // Move every message + attachment from source to target. The
    // history shows as one chronological thread on the target after.
    await tx
      .update(messages)
      .set({ ticketId: target.id })
      .where(eq(messages.ticketId, source.id));
    await tx
      .update(attachments)
      .set({ ticketId: target.id })
      .where(eq(attachments.ticketId, source.id));
    // Reparent the source's work-log entries so the merged ticket carries the
    // combined logged time (and the source's tech's time is attributable on the
    // surviving ticket). technician_id/_name are untouched, preserving
    // authorship for the frozen-history rules (req 4.6).
    await tx
      .update(workLogs)
      .set({ ticketId: target.id })
      .where(eq(workLogs.ticketId, source.id));

    // System message on the target announcing the merge so the
    // thread reads naturally.
    await tx.insert(messages).values({
      ticketId: target.id,
      authorId: user.id,
      authorEmail: actorEmail,
      authorName: actorName,
      authorType: "system",
      body: `Merged from ${source.ticketNumber} by ${actorName}.`,
      bodyFormat: "text",
      channel: "system",
    });

    // Second technician on the target (req 4.4).
    if (promoteSourceTechToPrimary) {
      await tx
        .update(tickets)
        .set({ assignedToId: sourceTech, assignedAt: now, updatedAt: now })
        .where(eq(tickets.id, target.id));
    } else if (addSourceTechAsCoAssignee) {
      await tx
        .insert(ticketAssignees)
        .values({
          ticketId: target.id,
          userId: sourceTech!,
          assignedById: user.id,
        })
        .onConflictDoNothing();
    }

    // Close + mark the source as a duplicate of the target. closedAt
    // stamps the merge time so it shows up in audit + filtering.
    await tx
      .update(tickets)
      .set({
        status: "closed",
        duplicateOfId: target.id,
        closedAt: now,
        updatedAt: now,
      })
      .where(eq(tickets.id, source.id));

    // Touch the target so it sorts to the top of the queue (someone
    // probably needs to read the just-added messages).
    await tx
      .update(tickets)
      .set({ updatedAt: now })
      .where(eq(tickets.id, target.id));

    // Worklogs moved between tickets — recompute the Monthly-Plan deduction for
    // both so the org balance stays consistent (source refunds to 0, target
    // re-deducts the combined total under its own billing policy).
    const a = await syncMonthlyPlanDeduction(tx, source.id);
    const b = await syncMonthlyPlanDeduction(tx, target.id);
    return [a, b];
  });
  await notifyBalanceChanged(mergeAffectedOrgIds);

  await audit({
    actorId: user.id,
    action: "ticket.merge",
    targetType: "ticket",
    targetId: source.ticketNumber,
    after: {
      mergedInto: target.ticketNumber,
      mergedAt: now.toISOString(),
      coAssignedTech: addSourceTechAsCoAssignee ? sourceTech : null,
      promotedTech: promoteSourceTechToPrimary ? sourceTech : null,
    },
  });

  revalidatePath("/admin/tickets");
  revalidatePath(`/admin/tickets/${sourceId}`);
  revalidatePath(`/admin/tickets/${target.id}`);
  return { ok: true, targetTicketNumber: target.ticketNumber };
}

export type MergeCandidate = {
  id: string;
  ticketNumber: string;
  subject: string;
  customerName: string;
};

/**
 * Candidate tickets the source can be merged INTO (req 4.1/4.2/4.3): same
 * organization as the source (by org link, else email domain), searchable by
 * ticket number OR subject, excluding the source itself, drafts, soft-deleted,
 * already-merged duplicates, and closed tickets. Superadmin-only.
 */
export async function listMergeCandidates(
  sourceId: string,
  query: string,
): Promise<MergeCandidate[]> {
  const user = await requireSessionUser();
  const source = await loadTicketScope(sourceId);
  if (!source) throw new NotFoundError();
  if (
    !(await can(
      user,
      "tickets.merge",
      { type: "ticket", ticket: source },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  const [sourceOrgRow] = await db
    .select({ organizationId: tickets.organizationId })
    .from(tickets)
    .where(eq(tickets.id, source.id))
    .limit(1);
  const sourceOrgId = sourceOrgRow?.organizationId ?? null;

  // Same-org filter — MUST mirror ticketsShareOrg(): linked source → exact org
  // match; unlinked source → other unlinked tickets sharing its email domain.
  let orgFilter: SQL;
  if (sourceOrgId) {
    orgFilter = eq(tickets.organizationId, sourceOrgId);
  } else {
    const sourceDomain = emailDomain(source.customerEmail);
    if (!sourceDomain) return [];
    // Domain = text after the LAST '@', matching emailDomain()'s lastIndexOf
    // semantics exactly (split_part(...,2) would take text after the FIRST '@'
    // and could leak a cross-org ticket for unusual multi-'@' addresses).
    orgFilter = and(
      isNull(tickets.organizationId),
      sql`lower(substring(${tickets.customerEmail} from '@([^@]+)$')) = ${sourceDomain}`,
    )!;
  }

  const trimmed = query.trim();
  const searchFilter = trimmed
    ? or(
        ilike(tickets.ticketNumber, `%${trimmed}%`),
        ilike(tickets.subject, `%${trimmed}%`),
      )!
    : undefined;

  const rows = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      customerName: tickets.customerName,
    })
    .from(tickets)
    .where(
      and(
        ne(tickets.id, source.id),
        isNull(tickets.deletedAt),
        isNull(tickets.duplicateOfId),
        ne(tickets.status, "draft"),
        // Only merge into an ACTIVELY-worked ticket — merging into a
        // resolved/closed one would bury the source's history where it won't
        // be triaged. Reopen the target first if that's really intended.
        ne(tickets.status, "closed"),
        ne(tickets.status, "resolved"),
        orgFilter,
        ...(searchFilter ? [searchFilter] : []),
      ),
    )
    .orderBy(desc(tickets.updatedAt))
    .limit(20);

  return rows;
}

// ── Reply (visible to customer) ──────────────────────────────────────

const replySchema = z.object({
  body: z.string().trim().min(1, "Reply cannot be empty").max(10000),
  attachmentIds: z.array(z.string().uuid()).max(20).default([]),
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

  // Resolve the agent's display name + email for the message + outbound email
  const [agent] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!agent) throw new NotFoundError();

  // First agent reply sets first_response_at (used by SLA monitor in M9)
  const isFirstAgentReply = ticket.status === "open";

  // Editor produces HTML; allowlist-strip server-side before storage.
  // Reject if visible content is empty (user submitted only forbidden
  // tags or whitespace).
  const cleanBody = sanitizeMessageHtml(parsed.data.body);
  if (htmlToPlainText(cleanBody).length === 0) {
    throw new Error("Reply cannot be empty");
  }

  await transactional(async (tx) => {
    const [inserted] = await tx
      .insert(messages)
      .values({
        ticketId: ticket.id,
        authorId: user.id,
        authorEmail: agent.email,
        authorName: agent.name,
        authorType: "agent",
        body: cleanBody,
        bodyFormat: "html",
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
    // Capture the reply text (plain) so the audit detail shows what was sent.
    after: { reply: htmlToPlainText(cleanBody) },
  });

  // Notify the customer — through the dispatcher (email + SMS + bell
  // honoring per-event prefs) for authenticated customers. Guest
  // tickets fall back to direct email; they have no preferences row,
  // no SMS phone, no in-app inbox. Outbound notifications carry plain
  // text only — the full HTML reply is visible in the portal via the
  // tracking URL.
  try {
    const appUrl = getAppUrl();
    const trackingUrl = ticketTrackingUrl({
      appUrl,
      ticketNumber: ticket.ticketNumber,
      customerEmail: ticket.customerEmail,
      customerId: ticket.customerId,
    });
    if (ticket.customerId) {
      await inngest.send({
        name: "notification/dispatch",
        data: {
          type: "ticket.agent_replied",
          recipientUserIds: [ticket.customerId],
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          email: {
            template: {
              template: "ticket_reply",
              data: {
                ticketNumber: ticket.ticketNumber,
                customerName: ticket.customerName,
                subject: ticket.subject,
                agentName: agent.name,
                body: htmlToPlainText(cleanBody),
                trackingUrl,
              },
            },
            ticketNumber: ticket.ticketNumber,
            replyToTicket: true,
          },
          sms: {
            template: {
              template: "agent_replied",
              data: { ticketNumber: ticket.ticketNumber, ticketUrl: trackingUrl },
            },
          },
          inApp: {
            titleArgs: { ticketNumber: ticket.ticketNumber },
            bodyArgs: {},
            linkUrl: `/portal/tickets/${ticket.ticketNumber}`,
          },
        },
      });
    } else {
      await sendEmail({
        to: ticket.customerEmail,
        template: {
          template: "ticket_reply",
          data: {
            ticketNumber: ticket.ticketNumber,
            customerName: ticket.customerName,
            subject: ticket.subject,
            agentName: agent.name,
            body: htmlToPlainText(cleanBody),
            trackingUrl,
          },
        },
        ticketNumber: ticket.ticketNumber,
        replyToTicket: true,
        // Surface the replying agent's name in the From: display so the
        // customer's inbox shows "Maria — Axiom360 Support" rather than
        // an anonymous brand-only sender.
        fromActorName: agent.name,
      });
    }
  } catch (err) {
    console.error("[replyToTicket] customer notification failed:", err);
  }

  // CC active external participants (req 5.2) — same-org colleagues the
  // requester looped in by email get future agent replies too. They have no
  // account, so email each directly with a Reply-To that threads their reply
  // back to the ticket. Best-effort; a send failure never fails the reply.
  try {
    const participants = await listActiveParticipants(ticket.id);
    if (participants.length > 0) {
      const appUrl = getAppUrl();
      const plain = htmlToPlainText(cleanBody);
      for (const p of participants) {
        if (p.email === ticket.customerEmail.toLowerCase()) continue;
        try {
          await sendEmail({
            to: p.email,
            template: {
              template: "ticket_reply",
              data: {
                ticketNumber: ticket.ticketNumber,
                customerName: p.name ?? p.email,
                subject: ticket.subject,
                agentName: agent.name,
                body: plain,
                trackingUrl: guestTicketUrl(appUrl, ticket.ticketNumber, p.email),
              },
            },
            ticketNumber: ticket.ticketNumber,
            replyToTicket: true,
            fromActorName: agent.name,
          });
        } catch (err) {
          console.error(
            `[replyToTicket] participant CC failed (${p.email}):`,
            err,
          );
        }
      }
    }
  } catch (err) {
    console.error("[replyToTicket] participant CC load failed:", err);
  }

  revalidatePath(`/admin/tickets/${ticketId}`);
}

// ── Internal note (agent-only, never visible to customer) ────────────

const internalNoteSchema = z.object({
  body: z.string().trim().min(1, "Internal note cannot be empty").max(10000),
  attachmentIds: z.array(z.string().uuid()).max(20).default([]),
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
  await enforceUserRateLimit("authInternalNote", user.id);
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

  // Internal notes also use the rich-text editor on the dashboard.
  const cleanBody = sanitizeMessageHtml(parsed.data.body);
  if (htmlToPlainText(cleanBody).length === 0) {
    throw new Error("Internal note cannot be empty");
  }

  await transactional(async (tx) => {
    const [inserted] = await tx
      .insert(messages)
      .values({
        ticketId: ticket.id,
        authorId: user.id,
        authorEmail: agent.email,
        authorName: agent.name,
        authorType: "agent",
        body: cleanBody,
        bodyFormat: "html",
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
    // Capture the note text (plain) so the audit detail shows what was written.
    after: { note: htmlToPlainText(cleanBody) },
  });

  // Notification fan-out (assigned tech, coordinators) lands with M11.
  // Crucially: NO customer email path here.

  revalidatePath(`/admin/tickets/${ticketId}`);
}

// ── Resolve ──────────────────────────────────────────────────────────

// Two resolution paths:
// - "note": the standard flow — author writes ≥10 chars explaining the
//   fix, message is stored with isResolutionNote=true, customer-visible.
// - "skip": Coordinator override (gated by `tickets.resolve_skip_note`).
//   No customer-facing resolution note. The skip reason is captured as
//   an internal note (so the team has visibility) AND in the audit log.
const resolveSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("note"),
    note: z
      .string()
      .trim()
      .min(10, "Resolution note must be at least 10 characters")
      .max(5000),
  }),
  z.object({
    kind: z.literal("skip"),
    skipReason: z
      .string()
      .trim()
      .min(10, "Skip reason must be at least 10 characters")
      .max(500),
  }),
]);

export type ResolveTicketInput = z.infer<typeof resolveSchema>;

export async function resolveTicket(
  ticketId: string,
  input: ResolveTicketInput,
): Promise<void> {
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
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

  // Skip-note path requires a separate, more privileged permission.
  if (
    parsed.data.kind === "skip" &&
    !(await can(
      user,
      "tickets.resolve_skip_note",
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

  await transactional(async (tx) => {
    if (parsed.data.kind === "note") {
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
    } else {
      // Skip path: write the skip reason as an internal note so the team
      // sees WHY no resolution note exists. Customer thread stays clean.
      await tx.insert(messages).values({
        ticketId: ticket.id,
        authorId: user.id,
        authorEmail: agent.email,
        authorName: agent.name,
        authorType: "agent",
        body: `Resolved without resolution note (Coordinator override). Reason: ${parsed.data.skipReason}`,
        channel: "dashboard",
        isInternalNote: true,
      });
    }
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
    after:
      parsed.data.kind === "note"
        ? { status: "resolved", resolution_note_provided: true }
        : {
            status: "resolved",
            resolution_note_provided: false,
            skip_reason: parsed.data.skipReason,
          },
  });

  // Accountant billing summary (req 8.9) — best-effort, processed async by the
  // notify-accountant-resolved Inngest function which derives the billing
  // outcome and emails the configured accountants.
  try {
    await inngest.send({
      name: "billing/ticket.resolved",
      data: { ticketId: ticket.id },
    });
  } catch (err) {
    console.error("[resolveTicket] accountant billing dispatch failed:", err);
  }

  // Customer notification — fan-out through the dispatcher so the
  // customer's email + SMS + in-app prefs are all honored (previously
  // this went through a direct `sendEmail` call, which meant SMS and
  // the bell-icon notification never fired on resolution). Auto-close
  // runs hourly in `inngest/functions/auto-close-resolved.ts`.
  try {
    const appUrl = getAppUrl();
    const trackingUrl = ticketTrackingUrl({
      appUrl,
      ticketNumber: ticket.ticketNumber,
      customerEmail: ticket.customerEmail,
      customerId: ticket.customerId,
    });
    const satToken = signCsatToken(ticket.ticketNumber, "satisfied");
    const unsatToken = signCsatToken(ticket.ticketNumber, "unsatisfied");
    if (ticket.customerId) {
      // Authenticated customer — dispatcher fans out email + SMS + in-app
      // based on their notification preferences.
      await inngest.send({
        name: "notification/dispatch",
        data: {
          type: "ticket.resolved",
          recipientUserIds: [ticket.customerId],
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          email: {
            template: {
              template: "ticket_resolved",
              data: {
                ticketNumber: ticket.ticketNumber,
                customerName: ticket.customerName,
                subject: ticket.subject,
                agentName: agent.name,
                resolutionNote:
                  parsed.data.kind === "note" ? parsed.data.note : "",
                csatSatisfiedUrl: `${appUrl}/csat/confirm?t=${ticket.ticketNumber}&tk=${satToken}`,
                csatUnsatisfiedUrl: `${appUrl}/csat/confirm?t=${ticket.ticketNumber}&tk=${unsatToken}`,
                trackingUrl,
              },
            },
            ticketNumber: ticket.ticketNumber,
            replyToTicket: true,
          },
          sms: {
            template: {
              template: "ticket_resolved",
              data: { ticketNumber: ticket.ticketNumber, ticketUrl: trackingUrl },
            },
          },
          inApp: {
            titleArgs: { ticketNumber: ticket.ticketNumber },
            bodyArgs: {},
            linkUrl: `/portal/tickets/${ticket.ticketNumber}`,
          },
        },
      });
    } else {
      // Guest ticket (no account) — no notification_preferences row,
      // no in-app inbox, no SMS phone. Fall back to a direct email,
      // same shape as before. The CSAT email link is the customer's
      // only way to respond in that case.
      await sendEmail({
        to: ticket.customerEmail,
        template: {
          template: "ticket_resolved",
          data: {
            ticketNumber: ticket.ticketNumber,
            customerName: ticket.customerName,
            subject: ticket.subject,
            agentName: agent.name,
            resolutionNote:
              parsed.data.kind === "note" ? parsed.data.note : "",
            csatSatisfiedUrl: `${appUrl}/csat/confirm?t=${ticket.ticketNumber}&tk=${satToken}`,
            csatUnsatisfiedUrl: `${appUrl}/csat/confirm?t=${ticket.ticketNumber}&tk=${unsatToken}`,
            trackingUrl,
          },
        },
        ticketNumber: ticket.ticketNumber,
        replyToTicket: true,
      });
    }
  } catch (err) {
    console.error("[resolveTicket] resolution notification failed:", err);
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

  // Notify customer — dispatch fan-out for authenticated customers
  // (email + SMS + bell honoring prefs); direct email fallback for
  // guests (no preferences row).
  try {
    const appUrl = getAppUrl();
    const trackingUrl = ticketTrackingUrl({
      appUrl,
      ticketNumber: ticket.ticketNumber,
      customerEmail: ticket.customerEmail,
      customerId: ticket.customerId,
    });
    if (ticket.customerId) {
      await inngest.send({
        name: "notification/dispatch",
        data: {
          type: "ticket.reopened",
          recipientUserIds: [ticket.customerId],
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          email: {
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
          },
          sms: {
            template: {
              template: "ticket_reopened",
              data: { ticketNumber: ticket.ticketNumber, ticketUrl: trackingUrl },
            },
          },
          inApp: {
            titleArgs: { ticketNumber: ticket.ticketNumber },
            bodyArgs: { reason: "A team member has reopened your ticket." },
            linkUrl: `/portal/tickets/${ticket.ticketNumber}`,
          },
        },
      });
    } else {
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
    }
  } catch (err) {
    console.error("[reopenTicket] customer notification failed:", err);
  }

  revalidatePath("/admin/tickets");
  revalidatePath(`/admin/tickets/${ticketId}`);
}

// ── Working-status control (Meeting-2, CR-13) ────────────────────────
//
// Lets staff move a ticket between the "in-flight" statuses — most
// importantly to "awaiting_customer_confirmation" when blocked on the
// customer, so completion time isn't held against the technician. Resolve /
// reopen / close keep their dedicated actions (they have side effects like
// CSAT). Resolved/closed/draft tickets are not touched here.

const WORKING_STATUSES = [
  "open",
  "in_progress",
  "awaiting_customer_confirmation",
] as const;
type WorkingStatus = (typeof WORKING_STATUSES)[number];

export async function setTicketStatus(
  ticketId: string,
  status: WorkingStatus,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!WORKING_STATUSES.includes(status)) {
    return { ok: false, error: "Invalid status." };
  }
  const user = await requireSessionUser();
  const ticket = await loadTicketScope(ticketId);
  if (!ticket) throw new NotFoundError();
  if (
    !(await can(
      user,
      "tickets.update",
      { type: "ticket", ticket },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }
  if (
    ticket.status === "resolved" ||
    ticket.status === "closed" ||
    ticket.status === "draft"
  ) {
    return {
      ok: false,
      error: "Use resolve or reopen to change a resolved or closed ticket.",
    };
  }
  if (ticket.status === status) return { ok: true };

  await db
    .update(tickets)
    .set({ status, updatedAt: new Date() })
    .where(eq(tickets.id, ticket.id));

  await audit({
    actorId: user.id,
    action: "ticket.status_change",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    before: { status: ticket.status },
    after: { status },
  });

  revalidatePath("/admin/tickets");
  revalidatePath(`/admin/tickets/${ticketId}`);
  return { ok: true };
}

// ── Billable categorization (Meeting-2, CR-16/17/18/19) ──────────────
//
// Set per individual ticket (not hardcoded per org). The boss's call:
// "give that access to everyone for now" — so the gate is the same
// tickets.update the assigned technician already holds. Toggling to/from
// 'monthly_plan' re-syncs the org's Monthly-Plan balance.

const BILLABLE_VALUES = [
  "yes",
  "no",
  "monthly_plan",
  "project",
  "rework",
] as const;
type BillableValue = (typeof BILLABLE_VALUES)[number];

export async function setTicketBillable(
  ticketId: string,
  billable: BillableValue | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (billable !== null && !BILLABLE_VALUES.includes(billable)) {
    return { ok: false, error: "Invalid billable category." };
  }
  const user = await requireSessionUser();
  const ticket = await loadTicketScope(ticketId);
  if (!ticket) throw new NotFoundError();
  if (
    !(await can(
      user,
      "tickets.update",
      { type: "ticket", ticket },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  const affectedOrgId = await transactional(async (tx) => {
    await tx
      .update(tickets)
      .set({ billable, updatedAt: new Date() })
      .where(eq(tickets.id, ticket.id));
    // Re-sync the Monthly-Plan deduction now the billable value changed.
    return syncMonthlyPlanDeduction(tx, ticket.id);
  });
  await notifyBalanceChanged([affectedOrgId]);

  await audit({
    actorId: user.id,
    action: "ticket.set_billable",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    after: { billable },
  });

  revalidatePath("/admin/tickets");
  revalidatePath(`/admin/tickets/${ticketId}`);
  return { ok: true };
}

// ── Escalate / De-escalate ───────────────────────────────────────────

const ESCALATION_REASONS = [
  "beyond_scope",
  "requires_access",
  "critical_impact",
  "vendor_involvement",
  "other",
] as const;
type EscalationReason = (typeof ESCALATION_REASONS)[number];

// Roles a ticket may be escalated TO (Meeting-2, CR-14). Constrained to the
// supervisory tier: `targetRole` is used verbatim as the notification
// `recipientRoles`, so accepting an arbitrary client string would let a caller
// broadcast a staff-worded escalation to ANY role — including "Customer"
// (req 6.4). Validate it server-side against this allowlist.
const ESCALATION_TARGET_ROLES = [
  "IT Director",
  "Coordinator",
  "Super Admin",
] as const;

const escalateSchema = z.object({
  // Spec §3.2 — categorical so reporting can group cleanly.
  reason: z.enum(ESCALATION_REASONS),
  // Optional supplementary context (max 1000 chars). Stored alongside
  // the categorical reason; never replaces it.
  note: z.string().trim().max(1000).optional(),
  // Who the ticket is being escalated TO: an upper-hierarchy role. Drives who
  // gets notified; stored on the ticket. Constrained to the supervisory tier.
  targetRole: z.enum(ESCALATION_TARGET_ROLES).optional(),
});

export async function escalateTicket(
  ticketId: string,
  reason: EscalationReason,
  note?: string,
  targetRole?: string,
): Promise<void> {
  const parsed = escalateSchema.safeParse({ reason, note, targetRole });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid reason");
  }

  const user = await requireSessionUser();
  await enforceUserRateLimit("authEscalate", user.id);
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

  const targetRoleClean = parsed.data.targetRole?.length
    ? parsed.data.targetRole
    : null;

  await db
    .update(tickets)
    .set({
      isEscalated: true,
      escalatedAt: new Date(),
      escalatedById: user.id,
      escalationReason: parsed.data.reason,
      escalationNote: parsed.data.note?.length ? parsed.data.note : null,
      escalationTargetRole: targetRoleClean,
      updatedAt: new Date(),
    })
    .where(eq(tickets.id, ticket.id));

  await audit({
    actorId: user.id,
    action: "ticket.escalate",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    after: {
      reason: parsed.data.reason,
      note: parsed.data.note ?? null,
      targetRole: targetRoleClean,
    },
  });

  // Notify IT Director + Coordinator via dispatch fan-out.
  try {
    const appUrl = getAppUrl();
    const ticketUrl = `${appUrl}/admin/tickets/${ticket.id}`;
    const technicianName = actor?.name ?? "An agent";
    await inngest.send({
      name: "notification/dispatch",
      data: {
        type: "ticket.escalated",
        // Notify the specific role the ticket was escalated to (CR-14); fall
        // back to the standard supervisory roles when none was selected.
        recipientRoles: targetRoleClean
          ? [targetRoleClean]
          : ["IT Director", "Coordinator"],
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
        sms: {
          template: {
            template: "ticket_escalated",
            data: { ticketNumber: ticket.ticketNumber, ticketUrl },
          },
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
      escalationNote: null,
      escalationTargetRole: null,
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
