"use server";

import {
  and,
  count,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";
import { can, isStrictTechnician } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { requireSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { auditLog } from "@/lib/db/schema/audit";
import { tickets } from "@/lib/db/schema/tickets";
import { type AuditOutcome } from "@/lib/audit/action-label";
import { ForbiddenError } from "@/lib/errors";

const PAGE_SIZE = 50;

export type AuditFilters = {
  /** ISO date strings, inclusive at the start, exclusive at the end. */
  from?: string;
  to?: string;
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  /** Free-text search across target id/label, action, and — for ticket-
   *  targeted entries — the ticket's current subject (joined by ticket
   *  number, since that's what's stored in target_id for ticket actions). */
  q?: string;
  outcome?: AuditOutcome;
};

export type AuditCursor = {
  /** Gapless insertion sequence of the last seen row. */
  seq: number;
};

export type AuditEntryRow = {
  id: string;
  timestamp: Date;
  actorId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  actorRoleSnapshot: string | null;
  impersonatorId: string | null;
  impersonatorEmail: string | null;
  impersonatorName: string | null;
  action: string;
  category: string | null;
  severity: string;
  outcome: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  ipAddress: string | null;
};

export type AuditEntryDetail = AuditEntryRow & {
  beforeValue: unknown;
  afterValue: unknown;
  userAgent: string | null;
  requestId: string | null;
  failureReason: string | null;
  /** Resolved names for any user-id UUIDs that appear in before/after, so the
   *  detail view can show "Jane Doe" instead of a raw id (e.g. `assignedToId`). */
  userNames: Record<string, string>;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Recursively collect UUID-shaped string values from an arbitrary JSON value
 *  (before/after snapshots). Used to resolve user ids to names. */
function collectUuids(value: unknown, acc: Set<string> = new Set()): string[] {
  if (typeof value === "string") {
    if (UUID_RE.test(value)) acc.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectUuids(v, acc);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectUuids(v, acc);
  }
  return [...acc];
}

export type ListAuditResult = {
  rows: AuditEntryRow[];
  nextCursor: AuditCursor | null;
};

const filterSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  actorId: z.string().uuid().optional(),
  action: z.string().min(1).max(120).optional(),
  targetType: z.string().min(1).max(60).optional(),
  targetId: z.string().min(1).max(120).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  outcome: z.enum(["success", "failure", "denied", "error"]).optional(),
});

const cursorSchema = z.object({
  // `seq` is a bigint; the pg/Neon driver hands bigints back as strings, so a
  // cursor that round-trips through the CSV exporter arrives with a string seq.
  // Coerce it so validation passes and the keyset advances — otherwise the
  // cursor is rejected, resets to page 1, and the export streams the same page
  // forever (a non-terminating response).
  seq: z.coerce.number().int().nonnegative(),
});

function buildWhere(
  filters: AuditFilters,
  cursor: AuditCursor | null,
): SQL | undefined {
  const clauses: SQL[] = [];

  if (filters.from) {
    clauses.push(gte(auditLog.timestamp, new Date(filters.from)));
  }
  if (filters.to) {
    clauses.push(lte(auditLog.timestamp, new Date(filters.to)));
  }
  if (filters.actorId) {
    clauses.push(eq(auditLog.actorId, filters.actorId));
  }
  if (filters.action) {
    clauses.push(eq(auditLog.action, filters.action));
  }
  if (filters.targetType) {
    clauses.push(eq(auditLog.targetType, filters.targetType));
  }
  if (filters.targetId) {
    clauses.push(eq(auditLog.targetId, filters.targetId));
  }
  if (filters.outcome) {
    clauses.push(eq(auditLog.outcome, filters.outcome));
  }
  if (filters.q) {
    const q = `%${filters.q.trim()}%`;
    // target_id covers ticket numbers (that's what's stored for ticket
    // actions) and other entities' ids; target_label covers whatever
    // callers snapshot a human-readable name into (e.g. a user's email at
    // sign-in). Ticket SUBJECT isn't stored on audit_log at all, so it's
    // matched via a live join against `tickets` by ticket number — works
    // retroactively for every past entry, not just ones written after this
    // search existed.
    clauses.push(sql`(
      ${auditLog.targetId} ILIKE ${q}
      OR ${auditLog.targetLabel} ILIKE ${q}
      OR ${auditLog.action} ILIKE ${q}
      OR EXISTS (
        SELECT 1 FROM ${tickets}
        WHERE ${tickets.ticketNumber} = ${auditLog.targetId}
          AND ${auditLog.targetType} = 'ticket'
          AND ${tickets.subject} ILIKE ${q}
      )
    )`);
  }

  if (cursor) {
    // Keyset on the gapless sequence — rows strictly older than the cursor.
    clauses.push(lt(auditLog.seq, cursor.seq));
  }

  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0];
  return and(...clauses);
}

// Convenience aliases for the impersonator self-join — drizzle's
// `aliasedTable` would be cleaner but the repo doesn't use it elsewhere.
// Two raw subselects keep the query readable.

/**
 * Page through the audit log. Cursor-based: the caller passes the cursor
 * returned by the previous call to fetch the next chunk. `nextCursor` is
 * `null` when there are no more rows.
 */
export async function listAuditEntries(opts: {
  filters?: AuditFilters;
  cursor?: AuditCursor | null;
  pageSize?: number;
}): Promise<ListAuditResult> {
  const caller = await requireSessionUser();
  if (
    !(await can(caller, "audit.view", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }

  const filters = filterSchema.safeParse(opts.filters ?? {});
  if (!filters.success) {
    return { rows: [], nextCursor: null };
  }
  // Req 7.1 — a normal (strict) technician may only see their OWN actions.
  // Force the actor filter to the caller, overriding any client-supplied
  // actorId so they can never page through another user's entries. Elevated
  // roles (Coordinator/IT Director/Super Admin) see everyone.
  const effectiveFilters: AuditFilters = isStrictTechnician(caller)
    ? { ...filters.data, actorId: caller.id }
    : filters.data;
  // Use the PARSED cursor (seq coerced to a real number), never the raw input,
  // so the keyset comparison in buildWhere binds a bigint-compatible number.
  const cursorParse = opts.cursor ? cursorSchema.safeParse(opts.cursor) : null;
  const cursor = cursorParse?.success ? cursorParse.data : null;

  const pageSize = Math.min(Math.max(opts.pageSize ?? PAGE_SIZE, 1), 200);
  const where = buildWhere(effectiveFilters, cursor);

  // Self-join twice via SQL aliasing for actor + impersonator emails/names.
  // Snapshot columns win; the join backfills legacy rows written before the
  // snapshot existed. NOTE: audit_log is referenced UNALIASED on purpose —
  // `buildWhere` produces refs qualified with the real table name.
  const result = await db.execute<{
    id: string;
    seq: number;
    timestamp: Date;
    actor_id: string | null;
    actor_email: string | null;
    actor_name: string | null;
    actor_role_snapshot: string | null;
    impersonator_id: string | null;
    impersonator_email: string | null;
    impersonator_name: string | null;
    action: string;
    category: string | null;
    severity: string;
    outcome: string;
    target_type: string | null;
    target_id: string | null;
    target_label: string | null;
    ip_address: string | null;
  }>(sql`
    SELECT audit_log.id, audit_log.seq, audit_log.timestamp, audit_log.actor_id,
           audit_log.actor_role_snapshot, audit_log.impersonator_id,
           audit_log.action, audit_log.category, audit_log.severity,
           audit_log.outcome, audit_log.target_type, audit_log.target_id,
           audit_log.target_label, audit_log.ip_address,
           COALESCE(audit_log.actor_name, ua.name) AS actor_name,
           COALESCE(audit_log.actor_email, ua.email) AS actor_email,
           COALESCE(audit_log.impersonator_name, ui.name) AS impersonator_name,
           COALESCE(audit_log.impersonator_email, ui.email) AS impersonator_email
    FROM audit_log
    LEFT JOIN users ua ON ua.id = audit_log.actor_id
    LEFT JOIN users ui ON ui.id = audit_log.impersonator_id
    ${where ? sql`WHERE ${where}` : sql``}
    ORDER BY audit_log.seq DESC
    LIMIT ${pageSize + 1}
  `);
  const rows = result.rows;

  const list = rows.slice(0, pageSize).map((r) => ({
    id: r.id,
    timestamp: new Date(r.timestamp),
    actorId: r.actor_id,
    actorEmail: r.actor_email,
    actorName: r.actor_name,
    actorRoleSnapshot: r.actor_role_snapshot,
    impersonatorId: r.impersonator_id,
    impersonatorEmail: r.impersonator_email,
    impersonatorName: r.impersonator_name,
    action: r.action,
    category: r.category,
    severity: r.severity,
    outcome: r.outcome,
    targetType: r.target_type,
    targetId: r.target_id,
    targetLabel: r.target_label,
    ipAddress: r.ip_address,
  }));

  // `seq` (bigint) arrives from the driver as a string — coerce to a number so
  // the returned cursor's declared `number` type is honest and the next keyset
  // page binds correctly.
  const nextCursor =
    rows.length > pageSize ? { seq: Number(rows[pageSize - 1].seq) } : null;

  return { rows: list, nextCursor };
}

export type AuditListRow = AuditEntryRow & {
  beforeValue: unknown;
  afterValue: unknown;
};

/**
 * Offset-paginated page of audit entries + the total row count — backs the
 * numbered pager on the audit page (mirrors the tickets queue). Includes the
 * before/after snapshots so the list can show a compact "what changed" summary.
 * Applies the same audit.view gate and strict-technician own-entries scope.
 */
export async function listAuditEntriesOffset(opts: {
  filters?: AuditFilters;
  limit: number;
  offset: number;
}): Promise<{ rows: AuditListRow[]; total: number }> {
  const caller = await requireSessionUser();
  if (
    !(await can(caller, "audit.view", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }
  const parsed = filterSchema.safeParse(opts.filters ?? {});
  if (!parsed.success) return { rows: [], total: 0 };
  const effectiveFilters: AuditFilters = isStrictTechnician(caller)
    ? { ...parsed.data, actorId: caller.id }
    : parsed.data;
  const where = buildWhere(effectiveFilters, null);
  const limit = Math.min(Math.max(opts.limit, 1), 201);
  const offset = Math.max(0, opts.offset);

  const [pageRes, countRes] = await Promise.all([
    db.execute<{
      id: string;
      timestamp: Date;
      actor_id: string | null;
      actor_email: string | null;
      actor_name: string | null;
      actor_role_snapshot: string | null;
      impersonator_id: string | null;
      impersonator_email: string | null;
      impersonator_name: string | null;
      action: string;
      category: string | null;
      severity: string;
      outcome: string;
      target_type: string | null;
      target_id: string | null;
      target_label: string | null;
      ip_address: string | null;
      before_value: unknown;
      after_value: unknown;
    }>(sql`
      SELECT audit_log.id, audit_log.timestamp, audit_log.actor_id,
             audit_log.actor_role_snapshot, audit_log.impersonator_id,
             audit_log.action, audit_log.category, audit_log.severity,
             audit_log.outcome, audit_log.target_type, audit_log.target_id,
             audit_log.target_label, audit_log.ip_address,
             audit_log.before_value, audit_log.after_value,
             COALESCE(audit_log.actor_name, ua.name) AS actor_name,
             COALESCE(audit_log.actor_email, ua.email) AS actor_email,
             COALESCE(audit_log.impersonator_name, ui.name) AS impersonator_name,
             COALESCE(audit_log.impersonator_email, ui.email) AS impersonator_email
      FROM audit_log
      LEFT JOIN users ua ON ua.id = audit_log.actor_id
      LEFT JOIN users ui ON ui.id = audit_log.impersonator_id
      ${where ? sql`WHERE ${where}` : sql``}
      ORDER BY audit_log.seq DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM audit_log
      ${where ? sql`WHERE ${where}` : sql``}
    `),
  ]);

  const rows: AuditListRow[] = pageRes.rows.map((r) => ({
    id: r.id,
    timestamp: new Date(r.timestamp),
    actorId: r.actor_id,
    actorEmail: r.actor_email,
    actorName: r.actor_name,
    actorRoleSnapshot: r.actor_role_snapshot,
    impersonatorId: r.impersonator_id,
    impersonatorEmail: r.impersonator_email,
    impersonatorName: r.impersonator_name,
    action: r.action,
    category: r.category,
    severity: r.severity,
    outcome: r.outcome,
    targetType: r.target_type,
    targetId: r.target_id,
    targetLabel: r.target_label,
    ipAddress: r.ip_address,
    beforeValue: r.before_value,
    afterValue: r.after_value,
  }));
  return { rows, total: countRes.rows[0]?.count ?? 0 };
}

/**
 * Lightweight async iterator used by the CSV exporter. Yields rows in
 * pages so the route handler streams to the client without ever holding
 * the full result set in memory.
 */
export async function* iterAuditEntries(
  filters: AuditFilters,
): AsyncGenerator<AuditEntryRow> {
  const caller = await requireSessionUser();
  if (
    !(await can(caller, "audit.export", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }
  const validated = filterSchema.safeParse(filters);
  if (!validated.success) return;

  let cursor: AuditCursor | null = null;
  // Each batch is bigger than the UI page size to amortize round-trips.
  const BATCH = 500;
  while (true) {
    const result = await listAuditEntries({
      filters: validated.data,
      cursor,
      pageSize: BATCH,
    });
    for (const row of result.rows) yield row;
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
}

/** Single-row read for the detail modal (full before/after JSON included). */
export async function getAuditEntry(
  id: string,
): Promise<AuditEntryDetail | null> {
  const caller = await requireSessionUser();
  if (
    !(await can(caller, "audit.view", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

  const result = await db.execute<{
    id: string;
    timestamp: Date;
    actor_id: string | null;
    actor_email: string | null;
    actor_name: string | null;
    actor_role_snapshot: string | null;
    impersonator_id: string | null;
    impersonator_email: string | null;
    impersonator_name: string | null;
    action: string;
    category: string | null;
    severity: string;
    outcome: string;
    failure_reason: string | null;
    target_type: string | null;
    target_id: string | null;
    target_label: string | null;
    ip_address: string | null;
    user_agent: string | null;
    request_id: string | null;
    before_value: unknown;
    after_value: unknown;
  }>(sql`
    SELECT a.id, a.timestamp, a.actor_id, a.actor_role_snapshot,
           a.impersonator_id, a.action, a.category, a.severity, a.outcome,
           a.failure_reason, a.target_type, a.target_id, a.target_label,
           a.ip_address, a.user_agent, a.request_id,
           a.before_value, a.after_value,
           COALESCE(a.actor_name, ua.name) AS actor_name,
           COALESCE(a.actor_email, ua.email) AS actor_email,
           COALESCE(a.impersonator_name, ui.name) AS impersonator_name,
           COALESCE(a.impersonator_email, ui.email) AS impersonator_email
    FROM audit_log a
    LEFT JOIN users ua ON ua.id = a.actor_id
    LEFT JOIN users ui ON ui.id = a.impersonator_id
    WHERE a.id = ${id}
    LIMIT 1
  `);
  const r = result.rows[0];
  if (!r) return null;
  // Req 7.1 — a strict technician may only open their own entries; deny
  // (as not-found) anything actioned by someone else, even by direct id.
  if (isStrictTechnician(caller) && r.actor_id !== caller.id) return null;

  // Resolve any user-id UUIDs in the before/after snapshots to display names
  // so the detail view shows "Jane Doe" rather than a raw id (e.g. a ticket
  // assignment records `assignedToId`). Non-user UUIDs (org/ticket ids) simply
  // won't match a users row and fall back to the raw value in the UI.
  const ids = collectUuids([r.before_value, r.after_value]);
  const userNames: Record<string, string> = {};
  if (ids.length > 0) {
    const nameRows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, ids));
    for (const u of nameRows) {
      if (u.name) userNames[u.id] = u.name;
    }
  }

  return {
    userNames,
    id: r.id,
    timestamp: new Date(r.timestamp),
    actorId: r.actor_id,
    actorEmail: r.actor_email,
    actorName: r.actor_name,
    actorRoleSnapshot: r.actor_role_snapshot,
    impersonatorId: r.impersonator_id,
    impersonatorEmail: r.impersonator_email,
    impersonatorName: r.impersonator_name,
    action: r.action,
    category: r.category,
    severity: r.severity,
    outcome: r.outcome,
    failureReason: r.failure_reason,
    targetType: r.target_type,
    targetId: r.target_id,
    targetLabel: r.target_label,
    ipAddress: r.ip_address,
    beforeValue: r.before_value,
    afterValue: r.after_value,
    userAgent: r.user_agent,
    requestId: r.request_id,
  };
}

/**
 * Resolves ticket NUMBERS (what's stored in `target_id` for ticket.* audit
 * rows) to their uuid, so the Target column can link straight to
 * /admin/tickets/[id] — that route takes the uuid, not the number. Batched
 * per page of audit rows rather than one query per row. A number with no
 * match (ticket hard-deleted, or a bad value) is simply absent from the
 * result — the caller renders that row as plain text instead of a link.
 */
export async function resolveTicketLinkIds(
  ticketNumbers: string[],
): Promise<Record<string, string>> {
  const caller = await requireSessionUser();
  if (
    !(await can(caller, "audit.view", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }
  if (ticketNumbers.length === 0) return {};
  const rows = await db
    .select({ id: tickets.id, ticketNumber: tickets.ticketNumber })
    .from(tickets)
    .where(inArray(tickets.ticketNumber, ticketNumbers));
  return Object.fromEntries(rows.map((r) => [r.ticketNumber, r.id]));
}

/** Count of `denied` entries in the last 24h — powers the page-top banner.
 *  Scoped to the caller's own entries for a strict technician, same as
 *  every other audit read (req 7.1). */
export async function countRecentDeniedEntries(): Promise<number> {
  const caller = await requireSessionUser();
  if (
    !(await can(caller, "audit.view", { type: "global" }, productionContext))
  ) {
    return 0;
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const ownOnly = isStrictTechnician(caller) ? caller.id : null;
  const [row] = await db
    .select({ value: count() })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.outcome, "denied"),
        gte(auditLog.timestamp, since),
        ownOnly ? eq(auditLog.actorId, ownOnly) : undefined,
      ),
    );
  return row?.value ?? 0;
}

// ── Filter helpers ──────────────────────────────────────────────────

/** Distinct target_type strings present in the log, for the Target type
 *  dropdown (replaces free-text entry — a typo'd type silently matched
 *  nothing and gave no feedback why). */
export async function listAuditTargetTypes(): Promise<string[]> {
  const caller = await requireSessionUser();
  if (
    !(await can(caller, "audit.view", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }
  // Req 7.1 — same own-entries scope as listAuditActions/listAuditActors.
  const ownOnly = isStrictTechnician(caller) ? caller.id : null;
  const rows = await db
    .selectDistinct({ targetType: auditLog.targetType })
    .from(auditLog)
    .where(
      ownOnly
        ? and(eq(auditLog.actorId, ownOnly), isNotNull(auditLog.targetType))
        : isNotNull(auditLog.targetType),
    )
    .orderBy(auditLog.targetType)
    .limit(100);
  return rows
    .map((r) => r.targetType)
    .filter((t): t is string => t !== null);
}

/** Distinct action strings present in the log, capped at 200 for the dropdown. */
export async function listAuditActions(): Promise<string[]> {
  const caller = await requireSessionUser();
  if (
    !(await can(caller, "audit.view", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }
  // Req 7.1 — scope the action dropdown to a strict technician's own entries
  // so it never reveals action types only present in others' logs.
  const ownOnly = isStrictTechnician(caller) ? caller.id : null;
  const rows = await db
    .selectDistinct({ action: auditLog.action })
    .from(auditLog)
    .where(ownOnly ? eq(auditLog.actorId, ownOnly) : undefined)
    .orderBy(auditLog.action)
    .limit(200);
  return rows.map((r) => r.action);
}

/** Users that have appeared as `actor_id` — filter dropdown source. */
export async function listAuditActors(): Promise<
  { id: string; name: string; email: string }[]
> {
  const caller = await requireSessionUser();
  if (
    !(await can(caller, "audit.view", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }
  // Req 7.1 — a strict technician can only filter by themselves, so the actor
  // dropdown lists only them (and only if they have any entries).
  const ownOnly = isStrictTechnician(caller) ? caller.id : null;
  const rows = await db
    .selectDistinct({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(auditLog)
    .innerJoin(users, eq(users.id, auditLog.actorId))
    .where(
      ownOnly
        ? eq(auditLog.actorId, ownOnly)
        : isNotNull(auditLog.actorId),
    )
    .limit(200);

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
