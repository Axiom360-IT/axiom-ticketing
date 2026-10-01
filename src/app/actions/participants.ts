"use server";
import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { requireSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { organizationTrustedEmails } from "@/lib/db/schema/organization-trusted-emails";
import { ticketParticipants } from "@/lib/db/schema/ticket-participants";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { buildSelfAddressFilter } from "@/lib/email/self-addresses";
import { enforceUserRateLimit } from "@/lib/ratelimit";
import { getSettings } from "@/lib/settings";
import { loadTicketScope } from "@/lib/tickets/load";
import {
  harvestParticipant,
  notifyParticipantAdded,
  upsertParticipant,
} from "@/lib/tickets/participants";

// ── Ticket participants: add / remove ─────────────────────────────────
//
// Gated by `tickets.manage_participants`, which can() scopes to the ticket:
// staff who can act on it, and the requesting customer on their OWN ticket.
// Approving a PENDING participant is deliberately NOT here — that is a
// staff-only decision and lives in actions/moderation.ts, or a guest could
// approve the strangers they themselves proposed.

export type ParticipantResult = { ok: true } | { ok: false; error: string };

const addSchema = z
  .object({
    ticketId: z.string().uuid(),
    // Staff add by address; a customer may only pick a colleague by id, which
    // is re-resolved server-side against their own organization.
    email: z.string().trim().toLowerCase().email().optional(),
    colleagueUserId: z.string().uuid().optional(),
  })
  .refine((v) => Boolean(v.email) !== Boolean(v.colleagueUserId), {
    message: "Provide either an email address or a colleague to add.",
  });

/** Addresses of ours that must never become a participant (mail loop). */
async function selfAddressFilter(): Promise<(email: string) => boolean> {
  const s = await getSettings<{
    support_email?: unknown;
    default_sender_email?: unknown;
    inbound_email_domain?: unknown;
  }>(["support_email", "default_sender_email", "inbound_email_domain"]);
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v : null;
  return buildSelfAddressFilter({
    supportEmail: str(s.support_email),
    senderEmails: [str(s.default_sender_email), process.env.RESEND_FROM_EMAIL],
    inboundDomain: str(s.inbound_email_domain),
  });
}

export async function addTicketParticipant(input: {
  ticketId: string;
  email?: string;
  colleagueUserId?: string;
}): Promise<ParticipantResult> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const user = await requireSessionUser();
  await enforceUserRateLimit("authReply", user.id);
  const ticket = await loadTicketScope(data.ticketId);
  if (!ticket) throw new NotFoundError();
  if (
    !(await can(
      user,
      "tickets.manage_participants",
      { type: "ticket", ticket },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  // A non-staff caller may never type a raw address — that is the guest
  // request path, which requires approval. They pick a colleague by id and we
  // resolve it against their own organization.
  const isStaff = user.permissions.has("tickets.update");
  let email: string;
  let name: string | null = null;

  if (data.colleagueUserId) {
    const [me] = await db
      .select({ organizationId: users.organizationId })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    if (!me?.organizationId && !isStaff) {
      return { ok: false, error: "Your account isn't linked to an organization." };
    }
    const [colleague] = await db
      .select({
        email: users.email,
        name: users.name,
        organizationId: users.organizationId,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.id, data.colleagueUserId))
      .limit(1);
    if (!colleague || !colleague.isActive) {
      return { ok: false, error: "That person is no longer available." };
    }
    // Cross-org guard: a customer may only ever add someone in their own org.
    if (!isStaff && colleague.organizationId !== me?.organizationId) {
      throw new ForbiddenError();
    }
    email = colleague.email.toLowerCase();
    name = colleague.name;
  } else {
    if (!isStaff) throw new ForbiddenError();
    email = data.email as string;
  }

  const isSelfAddress = await selfAddressFilter();
  if (isSelfAddress(email)) {
    return { ok: false, error: "That's one of our own addresses." };
  }
  if (
    email === ticket.customerEmail.toLowerCase() ||
    email === ticket.createdByEmail?.toLowerCase()
  ) {
    return { ok: false, error: "They already receive this ticket as the requester." };
  }
  if (ticket.organizationId) {
    const [trusted] = await db
      .select({ email: organizationTrustedEmails.email })
      .from(organizationTrustedEmails)
      .where(
        and(
          eq(organizationTrustedEmails.organizationId, ticket.organizationId),
          eq(organizationTrustedEmails.email, email),
        ),
      )
      .limit(1);
    if (trusted) {
      return {
        ok: false,
        error: "They're already a trusted contact for this organization.",
      };
    }
  }

  // Staff ARE the approval gate, so a staff add deliberately REACTIVATES a
  // previously removed row. A customer is not: routing them through the same
  // writer would let the requester overturn a staff rejection, since a
  // rejection and a removal are the same stored state. They get the
  // tombstone-respecting writer, and a removed row makes this a no-op we have
  // to report rather than silently treat as success.
  if (isStaff) {
    await upsertParticipant({
      ticketId: ticket.id,
      email,
      name,
      addedVia: "agent",
      addedById: user.id,
    });
  } else {
    const landed = await harvestParticipant({
      ticketId: ticket.id,
      email,
      name,
      addedVia: "requester",
      addedById: user.id,
      status: "active",
    });
    if (!landed) {
      return {
        ok: false,
        error: "That person was taken off this ticket. Ask us to add them back.",
      };
    }
  }

  // They're active immediately, so tell them — with a link for their own
  // address, not the requester's.
  await notifyParticipantAdded({ ticketId: ticket.id, email, name });

  await audit({
    actorId: user.id,
    action: "ticket.add_participant",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    after: { email, via: isStaff ? "agent" : "requester" },
  });

  revalidatePath(`/admin/tickets/${ticket.id}`);
  revalidatePath(`/portal/tickets/${ticket.ticketNumber}`);
  return { ok: true };
}

const removeSchema = z.object({
  ticketId: z.string().uuid(),
  participantId: z.string().uuid(),
});

export async function removeTicketParticipant(input: {
  ticketId: string;
  participantId: string;
}): Promise<ParticipantResult> {
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid input" };
  }
  const { ticketId, participantId } = parsed.data;

  const user = await requireSessionUser();
  const ticket = await loadTicketScope(ticketId);
  if (!ticket) throw new NotFoundError();
  if (
    !(await can(
      user,
      "tickets.manage_participants",
      { type: "ticket", ticket },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  // Soft flip, conditional on the current state so two concurrent clicks
  // can't double-apply. The tombstone is what stops an inbound email from
  // silently re-adding someone a human deliberately took off.
  const rows = await db
    .update(ticketParticipants)
    .set({ status: "removed" })
    .where(
      and(
        eq(ticketParticipants.id, participantId),
        eq(ticketParticipants.ticketId, ticket.id),
        ne(ticketParticipants.status, "removed"),
      ),
    )
    .returning({ email: ticketParticipants.email });

  if (rows.length === 0) {
    return { ok: false, error: "They're not on this ticket." };
  }

  await audit({
    actorId: user.id,
    action: "ticket.remove_participant",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    before: { email: rows[0].email, status: "active" },
    after: { status: "removed" },
  });

  revalidatePath(`/admin/tickets/${ticket.id}`);
  revalidatePath(`/portal/tickets/${ticket.ticketNumber}`);
  return { ok: true };
}
