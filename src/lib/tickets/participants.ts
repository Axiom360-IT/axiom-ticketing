import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { type Database, type Tx, db } from "@/lib/db/client";
import { organizationTrustedEmails } from "@/lib/db/schema/organization-trusted-emails";
import { organizationDomains } from "@/lib/db/schema/organizations";
import { ticketParticipants } from "@/lib/db/schema/ticket-participants";
import { tickets } from "@/lib/db/schema/tickets";
import { emailDomain } from "./org";

// ── Ticket participants (req 5.2) ─────────────────────────────────────
//
// How an inbound email sender relates to a ticket, used to decide whether a
// reply is posted, attributed-and-participated, or held for moderation.

export type SenderRelation =
  | "customer" // the original requester
  | "participant" // an already-recognized external contributor (this ticket)
  | "org-trusted" // an email a moderator marked legit for the ticket's org
  | "org-domain" // same organization as the ticket (trusted by email domain)
  | "foreign"; // unknown — hold for moderation (unless moderation is off)

type TicketLite = {
  id: string;
  customerEmail: string;
  organizationId: string | null;
};

// Public free-mail providers — a shared requester domain here means nothing
// about organizational membership, so we never auto-trust other senders on it.
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.net",
  "zoho.com",
  "mail.com",
  "yandex.com",
  "pm.me",
]);

/** Whether `domain` belongs to the ticket's organization (req 5.2/4.3). When
 *  the ticket is LINKED to an org, membership is authorized SOLELY by that org's
 *  registered domains. When it's UNLINKED (guest), we fall back to the original
 *  requester's own email domain — but NOT for public free-mail providers, where
 *  a shared domain says nothing about org membership. Mirrors ticketsShareOrg's
 *  precedence (never mixing a linked org with a bare requester-domain match). */
async function domainBelongsToTicketOrg(
  ticket: TicketLite,
  domain: string,
): Promise<boolean> {
  if (ticket.organizationId) {
    const [row] = await db
      .select({ id: organizationDomains.id })
      .from(organizationDomains)
      .where(
        and(
          eq(organizationDomains.organizationId, ticket.organizationId),
          eq(organizationDomains.domain, domain),
        ),
      )
      .limit(1);
    return Boolean(row);
  }
  // Unlinked ticket — trust the requester's own (non-free-mail) domain only.
  if (FREE_MAIL_DOMAINS.has(domain)) return false;
  return domain === emailDomain(ticket.customerEmail);
}

/** Classify an inbound sender's relationship to a ticket (req 5.2). The caller
 *  threads by a stable ticket token first; this decides authorization. */
export async function classifyInboundSender(
  ticket: TicketLite,
  senderEmail: string,
): Promise<SenderRelation> {
  const sender = (senderEmail ?? "").trim().toLowerCase();
  if (!sender) return "foreign";
  if (sender === ticket.customerEmail.trim().toLowerCase()) return "customer";

  const [existing] = await db
    .select({ id: ticketParticipants.id })
    .from(ticketParticipants)
    .where(
      and(
        eq(ticketParticipants.ticketId, ticket.id),
        eq(ticketParticipants.email, sender),
        eq(ticketParticipants.status, "active"),
      ),
    )
    .limit(1);
  if (existing) return "participant";

  // An address a moderator explicitly trusted for this ticket's organization
  // (req 5.2 follow-up) — auto-posts on ANY ticket of that org until revoked.
  if (
    ticket.organizationId &&
    (await isOrgTrustedEmail(ticket.organizationId, sender))
  ) {
    return "org-trusted";
  }

  const domain = emailDomain(sender);
  if (domain && (await domainBelongsToTicketOrg(ticket, domain))) {
    return "org-domain";
  }
  return "foreign";
}

/** Whether `email` is on the organization's trusted-contacts allowlist. */
async function isOrgTrustedEmail(
  organizationId: string,
  email: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: organizationTrustedEmails.id })
    .from(organizationTrustedEmails)
    .where(
      and(
        eq(organizationTrustedEmails.organizationId, organizationId),
        eq(organizationTrustedEmails.email, email.trim().toLowerCase()),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Mark an email as a trusted contact for an organization (moderator action).
 *  Idempotent; pass a transaction executor to run inside an existing tx. */
export async function addOrgTrustedEmail(
  args: {
    organizationId: string;
    email: string;
    name?: string | null;
    addedById?: string | null;
  },
  executor: Database | Tx = db,
): Promise<void> {
  const email = args.email.trim().toLowerCase();
  if (!email) return;
  await executor
    .insert(organizationTrustedEmails)
    .values({
      organizationId: args.organizationId,
      email,
      name: args.name ?? null,
      addedById: args.addedById ?? null,
    })
    .onConflictDoUpdate({
      target: [
        organizationTrustedEmails.organizationId,
        organizationTrustedEmails.email,
      ],
      set: {
        name: sql`coalesce(${args.name ?? null}, ${organizationTrustedEmails.name})`,
      },
    });
}

/** Add (or re-activate) an external contributor as an active participant.
 *  Pass a transaction executor to run inside an existing transaction. */
export async function upsertParticipant(
  args: {
    ticketId: string;
    email: string;
    name?: string | null;
    addedVia: "domain_auto" | "moderation" | "agent";
    addedById?: string | null;
  },
  executor: Database | Tx = db,
): Promise<void> {
  const email = args.email.trim().toLowerCase();
  if (!email) return;
  await executor
    .insert(ticketParticipants)
    .values({
      ticketId: args.ticketId,
      email,
      name: args.name ?? null,
      addedVia: args.addedVia,
      addedById: args.addedById ?? null,
      status: "active",
    })
    .onConflictDoUpdate({
      target: [ticketParticipants.ticketId, ticketParticipants.email],
      // Re-activate if previously removed; keep an existing name when the new
      // one is blank.
      set: {
        status: "active",
        name: sql`coalesce(${args.name ?? null}, ${ticketParticipants.name})`,
      },
    });
}

/** External recipients on a ticket (for CC-ing future updates + the
 *  "Participant" badge): the ticket's own active participants PLUS any of the
 *  organization's trusted contacts. Including org-trusted here (rather than
 *  minting participant rows) means revoking trust immediately drops them from
 *  CC and re-moderates them — one source of truth. Deduped by email. */
export async function listActiveParticipants(
  ticketId: string,
): Promise<{ email: string; name: string | null }[]> {
  const [participants, trusted] = await Promise.all([
    db
      .select({
        email: ticketParticipants.email,
        name: ticketParticipants.name,
      })
      .from(ticketParticipants)
      .where(
        and(
          eq(ticketParticipants.ticketId, ticketId),
          eq(ticketParticipants.status, "active"),
        ),
      ),
    db
      .select({
        email: organizationTrustedEmails.email,
        name: organizationTrustedEmails.name,
      })
      .from(organizationTrustedEmails)
      .innerJoin(
        tickets,
        eq(tickets.organizationId, organizationTrustedEmails.organizationId),
      )
      .where(eq(tickets.id, ticketId)),
  ]);

  const byEmail = new Map<string, { email: string; name: string | null }>();
  for (const p of [...participants, ...trusted]) {
    if (!byEmail.has(p.email)) byEmail.set(p.email, p);
  }
  return [...byEmail.values()];
}
