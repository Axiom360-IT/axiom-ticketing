import { and, desc, eq, gt, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema/tickets";
import { ticketEmailRefs } from "@/lib/db/schema/ticket-email-refs";
import {
  collectReferencedMessageIds,
  normalizeMessageId,
} from "@/lib/email/message-id";

// Robust inbound-reply → ticket resolution, used when the fast path
// (extractTicketNumber: number token in To / subject / refs) finds nothing.
// Two DB-backed strategies, tried in order, then the processor falls back to
// opening a new ticket:
//   1. Message-ID match — the reply's In-Reply-To/References vs. ids we've
//      recorded for a ticket. Precise (it's the real RFC thread chain).
//   2. Subject + sender match — same customer emailing about the same subject
//      on a still-open ticket. Catches threads that predate id capture.

// Statuses the subject+sender fallback must NOT match: terminal tickets
// (resolved/closed) so a stale reply opens a fresh ticket rather than
// resurrecting a done one, and drafts (incomplete submissions, not a real
// thread yet).
const FALLBACK_EXCLUDED_STATUSES = ["resolved", "closed", "draft"] as const;

// How far back the subject+sender fallback will look. Kept tight so an old,
// long-inactive thread with a generic subject can't vacuum up a new request.
const SUBJECT_FALLBACK_DAYS = 30;

/** Strip any run of leading Re:/Fw:/Fwd: prefixes, collapse whitespace, lower. */
function normalizeSubject(subject: string | null | undefined): string {
  if (!subject) return "";
  return subject
    .replace(/^((re|fwd?|fw)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Resolve the ticket a reply belongs to via the RFC Message-ID thread chain.
 * Returns the ticket number, or null if nothing matches a live ticket.
 */
export async function resolveTicketByMessageRefs(
  headers: Record<string, string>,
): Promise<string | null> {
  const ids = collectReferencedMessageIds(headers);
  if (ids.length === 0) return null;

  const rows = await db
    .select({
      ticketNumber: tickets.ticketNumber,
      createdAt: ticketEmailRefs.createdAt,
    })
    .from(ticketEmailRefs)
    .innerJoin(tickets, eq(tickets.id, ticketEmailRefs.ticketId))
    // Ignore soft-deleted tickets — a reply into a deleted thread should start
    // fresh, not silently attach to a hidden ticket.
    .where(and(inArray(ticketEmailRefs.rfcMessageId, ids), isNull(tickets.deletedAt)))
    .orderBy(desc(ticketEmailRefs.createdAt))
    .limit(1);

  return rows[0]?.ticketNumber ?? null;
}

/**
 * Fallback: same sender + same (prefix-stripped) subject on a still-open
 * ticket within the recent window. Conservative — exact normalized-subject
 * match, non-terminal status only, most recently active wins. Returns null for
 * an empty subject (too weak a signal to thread on).
 */
export async function resolveTicketBySubjectSender(
  fromEmail: string,
  subject: string | null,
): Promise<string | null> {
  const normFrom = fromEmail.trim().toLowerCase();
  const normSubject = normalizeSubject(subject);
  if (!normFrom || normSubject.length === 0) return null;

  const since = new Date(Date.now() - SUBJECT_FALLBACK_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await db
    .select({ ticketNumber: tickets.ticketNumber, subject: tickets.subject })
    .from(tickets)
    .where(
      and(
        eq(sql`lower(${tickets.customerEmail})`, normFrom),
        notInArray(tickets.status, [...FALLBACK_EXCLUDED_STATUSES]),
        isNull(tickets.deletedAt),
        gt(tickets.updatedAt, since),
      ),
    )
    .orderBy(desc(tickets.updatedAt))
    .limit(25);

  const hit = candidates.find(
    (c) => normalizeSubject(c.subject) === normSubject,
  );
  return hit?.ticketNumber ?? null;
}

/**
 * Record an inbound email's Message-ID against its ticket so future replies in
 * the same thread resolve by header. No-op when the header is absent or the id
 * is already recorded (first writer wins on the unique id).
 */
export async function recordInboundMessageId(
  ticketId: string,
  rawMessageId: string | null | undefined,
): Promise<void> {
  const normalized = normalizeMessageId(rawMessageId);
  if (!normalized) return;
  await db
    .insert(ticketEmailRefs)
    .values({ ticketId, rfcMessageId: normalized, direction: "inbound" })
    .onConflictDoNothing();
}
