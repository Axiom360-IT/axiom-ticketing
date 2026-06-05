"use server";

import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { isStrictRequester } from "@/lib/auth/can";
import { requireSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { procurementRequests } from "@/lib/db/schema/procurement";
import { tickets } from "@/lib/db/schema/tickets";
import { ticketsVisibilityCondition } from "@/lib/auth/scope";

// Global search backing the ⌘K palette. Returns at most a small number
// of hits per entity so the dropdown stays scannable. Each entity is
// gated by its own permission AND scope-filtered (a strict Technician
// only sees their assigned tickets in results).

const PER_ENTITY_LIMIT = 8;
const MIN_QUERY_LENGTH = 2;

export type SearchTicketHit = {
  id: string;
  ticketNumber: string;
  subject: string;
  status: string;
  priority: string;
  customerName: string;
};

export type SearchUserHit = {
  id: string;
  name: string;
  email: string;
};

export type SearchProcurementHit = {
  id: string;
  itemName: string;
  status: string;
  requestedByEmail: string;
  ticketId: string;
};

export type GlobalSearchResult = {
  query: string;
  tickets: SearchTicketHit[];
  users: SearchUserHit[];
  procurement: SearchProcurementHit[];
};

function asEmpty(query: string): GlobalSearchResult {
  return { query, tickets: [], users: [], procurement: [] };
}

export async function globalSearch(rawQuery: string): Promise<GlobalSearchResult> {
  const query = rawQuery.trim();
  if (query.length < MIN_QUERY_LENGTH) return asEmpty(query);

  const caller = await requireSessionUser();
  const like = `%${query}%`;

  // ── Tickets ──────────────────────────────────────────────────
  // Gate per row via the existing ticketsVisibilityCondition helper —
  // it already encodes "Tech sees own assigned, Customer sees own,
  // everyone else sees all" matching the can() rules. Search includes the
  // worked-on carry-over so a technician can still find (and open read-only) a
  // ticket they logged work on after it was reassigned away (req 3.4), even
  // though it has left their active queue (req 3.3).
  let ticketHits: SearchTicketHit[] = [];
  if (await can(caller, "tickets.view", { type: "global" }, productionContext)) {
    const visibility = ticketsVisibilityCondition(caller, {
      includeWorkedOn: true,
    });
    const matches = or(
      ilike(tickets.ticketNumber, like),
      ilike(tickets.subject, like),
      ilike(tickets.description, like),
      ilike(tickets.customerName, like),
      ilike(tickets.customerEmail, like),
    );
    const where: SQL | undefined =
      visibility && matches ? and(visibility, matches) : (visibility ?? matches);
    const rows = await db
      .select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        subject: tickets.subject,
        status: tickets.status,
        priority: tickets.priority,
        customerName: tickets.customerName,
      })
      .from(tickets)
      .where(where)
      .orderBy(desc(tickets.updatedAt))
      .limit(PER_ENTITY_LIMIT);
    ticketHits = rows;
  }

  // ── Users ────────────────────────────────────────────────────
  let userHits: SearchUserHit[] = [];
  if (await can(caller, "users.view", { type: "global" }, productionContext)) {
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
      })
      .from(users)
      .where(
        and(
          eq(users.isActive, true),
          or(ilike(users.name, like), ilike(users.email, like)),
        ),
      )
      .orderBy(users.name)
      .limit(PER_ENTITY_LIMIT);
    userHits = rows;
  }

  // ── Procurement ─────────────────────────────────────────────
  let procurementHits: SearchProcurementHit[] = [];
  if (
    await can(caller, "procurement.view", { type: "global" }, productionContext)
  ) {
    const matches = or(
      ilike(procurementRequests.itemName, like),
      ilike(procurementRequests.vendor, like),
      ilike(procurementRequests.requestedByEmail, like),
    );
    const where: SQL | undefined = isStrictRequester(caller)
      ? and(eq(procurementRequests.requestedById, caller.id), matches)
      : matches;
    const rows = await db
      .select({
        id: procurementRequests.id,
        itemName: procurementRequests.itemName,
        status: procurementRequests.status,
        requestedByEmail: procurementRequests.requestedByEmail,
        ticketId: procurementRequests.ticketId,
      })
      .from(procurementRequests)
      .where(where)
      .orderBy(desc(procurementRequests.createdAt))
      .limit(PER_ENTITY_LIMIT);
    procurementHits = rows;
  }

  return {
    query,
    tickets: ticketHits,
    users: userHits,
    procurement: procurementHits,
  };
}
