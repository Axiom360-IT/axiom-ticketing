import "server-only";
import { and, eq, ne, sql, type SQL } from "drizzle-orm";
import { type Database, type Tx, db } from "@/lib/db/client";
import { isFreeMailDomain } from "@/lib/email/free-mail";
import { buildSelfAddressFilter } from "@/lib/email/self-addresses";
import { getSettings } from "@/lib/settings";
import { sendEmail } from "@/lib/email/send";
import { getAppUrl } from "@/lib/request";
import { guestTicketUrl } from "@/lib/tokens";
import { organizationTrustedEmails } from "@/lib/db/schema/organization-trusted-emails";
import { users } from "@/lib/db/schema/auth";
import {
  organizationDomains,
  organizations,
} from "@/lib/db/schema/organizations";
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
  if (isFreeMailDomain(domain)) return false;
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
/** How a participant got onto the ticket.
 *   domain_auto   — inbound reply from the ticket org's own domain
 *   moderation    — a coordinator approved them
 *   agent         — staff added them by hand
 *   requester     — the ticket's own customer picked a colleague
 *   guest_request — typed on the guest form; always needs approval
 *   recipient     — harvested from an inbound To/CC header */
export type ParticipantAddedVia =
  | "domain_auto"
  | "moderation"
  | "agent"
  | "requester"
  | "guest_request"
  | "recipient";

export async function upsertParticipant(
  args: {
    ticketId: string;
    email: string;
    name?: string | null;
    addedVia: ParticipantAddedVia;
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

// ── Participants panel (read model) ───────────────────────────────────
//
// Everything the Participants card shows, in one query pair. Deliberately
// separate from `listActiveParticipants`, which is load-bearing for the CC
// loop and the thread badge and must keep returning ONLY active addresses.
// This one also surfaces pending and removed rows, and who added whom.

export type ParticipantPanelRow =
  | {
      kind: "participant";
      id: string;
      email: string;
      name: string | null;
      addedVia: string;
      status: string;
      addedByName: string | null;
      createdAt: Date;
    }
  | {
      kind: "org_trusted";
      email: string;
      name: string | null;
      organizationId: string;
      organizationName: string | null;
    };

/**
 * Who is looking. The panel shows strictly less the further out you sit:
 *
 *   staff    — everything. They are the approval gate, so they need the
 *              removed rows and the organization's trusted roster to judge
 *              an address they don't recognise.
 *   customer — the signed-in requester and their colleagues. Pending rows
 *              stay, so adding someone visibly does something, but removed
 *              rows go (that a person was taken off is a staff matter).
 *   guest    — a token-bearing outsider on one ticket. Same as customer.
 *
 * The organization's trusted-contact roster is staff-only for both of the
 * outer two: it is an admin allowlist spanning OTHER tickets, so rendering
 * it here would tell anyone holding one guest link which outside firms the
 * organization deals with.
 */
export type ParticipantPanelAudience = "staff" | "customer" | "guest";

export async function listTicketParticipantsForPanel(
  ticketId: string,
  audience: ParticipantPanelAudience = "staff",
): Promise<ParticipantPanelRow[]> {
  const isStaff = audience === "staff";

  const [rows, trusted] = await Promise.all([
    db
      .select({
        id: ticketParticipants.id,
        email: ticketParticipants.email,
        name: ticketParticipants.name,
        addedVia: ticketParticipants.addedVia,
        status: ticketParticipants.status,
        addedByName: users.name,
        createdAt: ticketParticipants.createdAt,
      })
      .from(ticketParticipants)
      .leftJoin(users, eq(users.id, ticketParticipants.addedById))
      .where(
        isStaff
          ? eq(ticketParticipants.ticketId, ticketId)
          : and(
              eq(ticketParticipants.ticketId, ticketId),
              ne(ticketParticipants.status, "removed"),
            ),
      )
      .orderBy(ticketParticipants.createdAt),
    isStaff
      ? db
          .select({
            email: organizationTrustedEmails.email,
            name: organizationTrustedEmails.name,
            organizationId: organizationTrustedEmails.organizationId,
            organizationName: organizations.name,
          })
          .from(organizationTrustedEmails)
          .innerJoin(
            tickets,
            eq(
              tickets.organizationId,
              organizationTrustedEmails.organizationId,
            ),
          )
          .leftJoin(
            organizations,
            eq(organizations.id, organizationTrustedEmails.organizationId),
          )
          .where(eq(tickets.id, ticketId))
      : [],
  ]);

  const out: ParticipantPanelRow[] = rows.map((r) => ({
    kind: "participant" as const,
    id: r.id,
    email: r.email,
    name: r.name,
    addedVia: r.addedVia,
    status: r.status,
    addedByName: r.addedByName,
    createdAt: r.createdAt,
  }));

  // An org-trusted contact who ALSO has a row on this ticket is shown once,
  // as the participant row — that row is the one with per-ticket state.
  const seen = new Set(out.map((r) => r.email.toLowerCase()));
  for (const t of trusted) {
    if (seen.has(t.email.toLowerCase())) continue;
    seen.add(t.email.toLowerCase());
    out.push({
      kind: "org_trusted",
      email: t.email,
      name: t.name,
      organizationId: t.organizationId,
      organizationName: t.organizationName,
    });
  }
  return out;
}

// ── Automatic / unapproved participant writes ─────────────────────────

/**
 * The write path for every NON-staff source: a guest's typed address, a
 * colleague picked by the requester, an address harvested from an inbound
 * To/CC.
 *
 * Differs from `upsertParticipant` in exactly one way that matters: it will
 * never resurrect a `removed` row. `upsertParticipant` sets `status:'active'`
 * unconditionally, which is right for a deliberate STAFF re-add and wrong for
 * everything here — without this, one inbound email would silently put back
 * someone a coordinator had removed, on every subsequent email, forever.
 *
 * Returns whether a row actually landed. `false` means the tombstone blocked
 * it — or, on the `pending` branch, that some decision already exists for this
 * address, which is a harmless duplicate request rather than a failure. The
 * callers that can surface an error to a human check it; the automatic ones
 * ignore it by design.
 */
export async function harvestParticipant(
  args: {
    ticketId: string;
    email: string;
    name?: string | null;
    addedVia: ParticipantAddedVia;
    addedById?: string | null;
    /** 'pending' waits for staff approval; 'active' joins immediately. */
    status: "pending" | "active";
  },
  executor: Database | Tx = db,
): Promise<boolean> {
  const email = args.email.trim().toLowerCase();
  if (!email) return false;

  if (args.status === "pending") {
    // A request never overwrites an existing decision — active stays active,
    // removed stays removed, and a duplicate request is a no-op.
    const landed = await executor
      .insert(ticketParticipants)
      .values({
        ticketId: args.ticketId,
        email,
        name: args.name ?? null,
        addedVia: args.addedVia,
        addedById: args.addedById ?? null,
        status: "pending",
      })
      .onConflictDoNothing()
      .returning();
    return landed.length > 0;
  }

  const landed = await executor
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
      set: {
        status: "active",
        name: sql`coalesce(${args.name ?? null}, ${ticketParticipants.name})`,
      },
      // The tombstone: a human took them off, so an automatic path may not
      // put them back.
      setWhere: ne(ticketParticipants.status, "removed"),
    })
    .returning();
  return landed.length > 0;
}

/**
 * Re-moderate the auto-joined participants of a ticket that has just moved to
 * a different organization.
 *
 * An address that joined by matching the OLD org's domain has no standing on
 * the new one, and `listActiveParticipants` would keep CC-ing it on every
 * reply about a ticket that now belongs to someone else.
 *
 * Two deliberate narrowings:
 *   - only `domain_auto` rows, the ones no human ever vouched for. A row added
 *     by staff, approved by a coordinator, or picked by the requester stays —
 *     a human put them there and only a human takes them off.
 *   - demoted to `pending`, not `removed`. This is a re-moderation, not a
 *     removal: they stop receiving mail immediately, and a coordinator can
 *     approve them back from the queue. `removed` would be a tombstone that
 *     an automatic path could never undo.
 *
 * Returns the addresses demoted, for the caller's audit entry.
 */
export async function demoteForeignAutoJoinedParticipants(
  args: { ticketId: string; organizationId: string | null },
  executor: Database | Tx = db,
): Promise<string[]> {
  const rows = await executor
    .select({ id: ticketParticipants.id, email: ticketParticipants.email })
    .from(ticketParticipants)
    .where(
      and(
        eq(ticketParticipants.ticketId, args.ticketId),
        eq(ticketParticipants.status, "active"),
        eq(ticketParticipants.addedVia, "domain_auto"),
      ),
    );
  if (rows.length === 0) return [];

  // The new org's domains, once, rather than a query per participant.
  const allowed = new Set<string>();
  if (args.organizationId) {
    const domains = await executor
      .select({ domain: organizationDomains.domain })
      .from(organizationDomains)
      .where(eq(organizationDomains.organizationId, args.organizationId));
    for (const d of domains) allowed.add(d.domain.toLowerCase());
  }

  const demoted: string[] = [];
  for (const row of rows) {
    const domain = emailDomain(row.email);
    if (domain && allowed.has(domain)) continue;
    await executor
      .update(ticketParticipants)
      .set({ status: "pending" })
      .where(eq(ticketParticipants.id, row.id));
    demoted.push(row.email);
  }
  return demoted;
}

export type PendingParticipant = {
  id: string;
  email: string;
  name: string | null;
  addedVia: string;
  createdAt: Date;
  ticketId: string;
  ticketNumber: string;
  ticketSubject: string;
  ticketCustomerEmail: string;
  /** How the ticket's org was determined — context for the approver, since a
   *  guest request on an `unverified` ticket is the least-evidenced case. */
  orgMatchStatus: string;
  organizationId: string | null;
};

/** Every participant awaiting a decision, newest last. Caller supplies the
 *  ticket-visibility predicate so a strict technician only sees their own. */
export async function listPendingParticipants(
  visibility: SQL | undefined,
): Promise<PendingParticipant[]> {
  return db
    .select({
      id: ticketParticipants.id,
      email: ticketParticipants.email,
      name: ticketParticipants.name,
      addedVia: ticketParticipants.addedVia,
      createdAt: ticketParticipants.createdAt,
      ticketId: tickets.id,
      ticketNumber: tickets.ticketNumber,
      ticketSubject: tickets.subject,
      ticketCustomerEmail: tickets.customerEmail,
      orgMatchStatus: tickets.orgMatchStatus,
      organizationId: tickets.organizationId,
    })
    .from(ticketParticipants)
    .innerJoin(tickets, eq(tickets.id, ticketParticipants.ticketId))
    .where(
      visibility
        ? and(eq(ticketParticipants.status, "pending"), visibility)
        : eq(ticketParticipants.status, "pending"),
    )
    .orderBy(ticketParticipants.createdAt);
}

/** The self-address predicate, resolved from settings. Every participant
 *  write path must consult it — adding one of our own addresses CCs us into
 *  our own thread and starts a mail loop. */
export async function selfAddressFilterFromSettings(): Promise<
  (email: string) => boolean
> {
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

/**
 * Tell someone they're now on a ticket, with a link minted for their own
 * address.
 *
 * Only ever called on a transition into `active` that a HUMAN caused — staff
 * added them, the requester picked them, or a coordinator approved a pending
 * request. Never for a pending row (nobody has vouched for that address yet,
 * and the subject line alone would leak what the ticket is about) and never
 * for an inbound auto-join (they just emailed in about it — they know).
 *
 * Best-effort by design: the participant row is already committed, and a
 * Resend hiccup must not roll that back. Returns whether the mail actually
 * went out, so the caller can tell the person "added, but the invitation
 * didn't send" instead of a flat success they'd have no reason to doubt.
 */
export async function notifyParticipantAdded(args: {
  ticketId: string;
  email: string;
  name?: string | null;
}): Promise<boolean> {
  try {
    const [t] = await db
      .select({
        ticketNumber: tickets.ticketNumber,
        subject: tickets.subject,
        customerName: tickets.customerName,
      })
      .from(tickets)
      .where(eq(tickets.id, args.ticketId))
      .limit(1);
    if (!t) return false;

    const appUrl = getAppUrl();
    await sendEmail({
      to: args.email,
      template: {
        template: "participant_added",
        data: {
          participantName: args.name ?? null,
          ticketNumber: t.ticketNumber,
          subject: t.subject,
          customerName: t.customerName,
          ticketUrl: guestTicketUrl(appUrl, t.ticketNumber, args.email),
        },
      },
      ticketNumber: t.ticketNumber,
      replyToTicket: true,
    });
    return true;
  } catch (err) {
    console.error("[participants] added-notification failed:", err);
    return false;
  }
}

// ── Inbound To/CC harvesting ──────────────────────────────────────────

export type HarvestOutcome = {
  autoJoined: string[];
  pending: string[];
  skipped: number;
  /** Addresses whose write threw. The loop carries on past them so one bad
   *  address can't cost the others their row, and the caller audits these
   *  alongside what landed. */
  failed: string[];
};

/**
 * Turn the To/CC lines of an inbound email into ticket participants.
 *
 * The rule, and every guard behind it:
 *
 *  - **Our own addresses are dropped first.** `ops@support.axiom360.it` is on
 *    the To line of literally every inbound ticket email; adding it would CC
 *    us into our own thread and start a loop.
 *  - **An address on the ticket organization's registered domain auto-joins**,
 *    as does one already trusted for that org. Everyone else lands `pending`
 *    for a coordinator — a stranger who happened to be CC'd once never starts
 *    receiving the thread on their own.
 *  - **Free-mail domains can never auto-join**, even if someone registered
 *    gmail.com as an org domain. Without this floor, one bad org-domain row
 *    turns CC harvesting into an open subscription.
 *  - **An unauthenticated sender forces everything to `pending`.** The From
 *    header is trivially forged, so a spoofed message must not be able to
 *    nominate its own auto-joining recipients.
 *  - Removed rows stay removed (`harvestParticipant` never resurrects), and
 *    the requester + existing participants are skipped as duplicates.
 */
export async function harvestRecipients(args: {
  ticket: { id: string; customerEmail: string; organizationId: string | null };
  /** To + Cc, in any order; deduped here. */
  addresses: string[];
  /** False when the sender failed DMARC/SPF/DKIM and auth is being enforced —
   *  nothing may auto-join off an unverified From. */
  senderAuthenticated: boolean;
  isSelfAddress: (email: string) => boolean;
  /**
   * Join the addresses that belong to the ticket's own organization and skip
   * every other one, instead of holding it as `pending`.
   *
   * Used for a STAFF reply. A technician Cc'ing the customer's colleague means
   * "loop them in", and that colleague should join. But a technician's Reply-All
   * also carries their own coworkers, and those would each become a `pending`
   * row — a moderation queue full of our own staff, for a decision no
   * coordinator should have to make. Skipping is the honest outcome: we add who
   * we can place, and nominate nobody.
   */
  autoJoinOnly?: boolean;
}): Promise<HarvestOutcome> {
  const out: HarvestOutcome = {
    autoJoined: [],
    pending: [],
    skipped: 0,
    failed: [],
  };
  const seen = new Set<string>([args.ticket.customerEmail.toLowerCase()]);

  for (const raw of args.addresses) {
    const email = raw.trim().toLowerCase();
    if (!email || seen.has(email)) {
      out.skipped++;
      continue;
    }
    seen.add(email);
    if (args.isSelfAddress(email)) {
      out.skipped++;
      continue;
    }

    const domain = emailDomain(email);
    // No parseable domain means this isn't an address at all, however it got
    // here. Without this it falls through as "free mail" and lands in the
    // moderation queue as something a coordinator is asked to approve.
    if (!domain) {
      out.skipped++;
      continue;
    }
    const freeMail = isFreeMailDomain(domain);
    const orgMatch =
      !freeMail &&
      args.senderAuthenticated &&
      domain !== null &&
      (await domainBelongsToTicketOrg(args.ticket, domain));
    const trusted =
      args.senderAuthenticated &&
      args.ticket.organizationId !== null &&
      (await isOrgTrustedEmail(args.ticket.organizationId, email));

    // An org-trusted contact gets NO participant row. `listActiveParticipants`
    // already unions the organization's trusted contacts in, precisely so that
    // revoking trust drops them from CC everywhere at once — minting a row here
    // would outlive the revocation and strand them on this ticket forever, and
    // would also show a Remove button that cannot actually remove them.
    if (trusted) {
      out.skipped++;
      continue;
    }

    const status: "active" | "pending" = orgMatch ? "active" : "pending";
    if (status === "pending" && args.autoJoinOnly) {
      out.skipped++;
      continue;
    }
    // One address failing must not abandon the rest of the line, and must not
    // throw away the record of the ones that did land.
    try {
      await harvestParticipant({
        ticketId: args.ticket.id,
        email,
        addedVia: status === "active" ? "domain_auto" : "recipient",
        status,
      });
    } catch (err) {
      console.error(`[participants] harvest failed for ${email}:`, err);
      out.failed.push(email);
      continue;
    }
    if (status === "active") out.autoJoined.push(email);
    else out.pending.push(email);
  }
  return out;
}
