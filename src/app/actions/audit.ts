"use server";

import {
  and,
  eq,
  gte,
  isNotNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { requireSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { auditLog } from "@/lib/db/schema/audit";
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
};

export type AuditCursor = {
  /** ISO timestamp of the last seen row. */
  timestamp: string;
  id: string;
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
  targetType: string | null;
  targetId: string | null;
  ipAddress: string | null;
};

export type AuditEntryDetail = AuditEntryRow & {
  beforeValue: unknown;
  afterValue: unknown;
  userAgent: string | null;
  requestId: string | null;
};

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
});

const cursorSchema = z.object({
  timestamp: z.string().datetime(),
  id: z.string().uuid(),
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

  if (cursor) {
    // Keyset: rows STRICTLY older than the cursor (tie-break by id).
    const cursorTime = new Date(cursor.timestamp);
    const tieBreak = and(
      eq(auditLog.timestamp, cursorTime),
      lt(auditLog.id, cursor.id),
    );
    const beyond = or(lt(auditLog.timestamp, cursorTime), tieBreak);
    if (beyond) clauses.push(beyond);
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
  const cursor = opts.cursor
    ? cursorSchema.safeParse(opts.cursor).success
      ? opts.cursor
      : null
    : null;

  const pageSize = Math.min(Math.max(opts.pageSize ?? PAGE_SIZE, 1), 200);
  const where = buildWhere(filters.data, cursor);

  // Self-join twice via SQL aliasing for actor + impersonator emails/names.
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
    target_type: string | null;
    target_id: string | null;
    ip_address: string | null;
  }>(sql`
    SELECT a.id, a.timestamp, a.actor_id, a.actor_role_snapshot,
           a.impersonator_id, a.action, a.target_type, a.target_id,
           a.ip_address,
           ua.email AS actor_email, ua.name AS actor_name,
           ui.email AS impersonator_email, ui.name AS impersonator_name
    FROM audit_log a
    LEFT JOIN users ua ON ua.id = a.actor_id
    LEFT JOIN users ui ON ui.id = a.impersonator_id
    ${where ? sql`WHERE ${where}` : sql``}
    ORDER BY a.timestamp DESC, a.id DESC
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
    targetType: r.target_type,
    targetId: r.target_id,
    ipAddress: r.ip_address,
  }));

  const nextCursor =
    rows.length > pageSize
      ? {
          timestamp: list[list.length - 1].timestamp.toISOString(),
          id: list[list.length - 1].id,
        }
      : null;

  return { rows: list, nextCursor };
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
    target_type: string | null;
    target_id: string | null;
    ip_address: string | null;
    user_agent: string | null;
    request_id: string | null;
    before_value: unknown;
    after_value: unknown;
  }>(sql`
    SELECT a.id, a.timestamp, a.actor_id, a.actor_role_snapshot,
           a.impersonator_id, a.action, a.target_type, a.target_id,
           a.ip_address, a.user_agent, a.request_id,
           a.before_value, a.after_value,
           ua.email AS actor_email, ua.name AS actor_name,
           ui.email AS impersonator_email, ui.name AS impersonator_name
    FROM audit_log a
    LEFT JOIN users ua ON ua.id = a.actor_id
    LEFT JOIN users ui ON ui.id = a.impersonator_id
    WHERE a.id = ${id}
    LIMIT 1
  `);
  const r = result.rows[0];
  if (!r) return null;
  return {
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
    targetType: r.target_type,
    targetId: r.target_id,
    ipAddress: r.ip_address,
    beforeValue: r.before_value,
    afterValue: r.after_value,
    userAgent: r.user_agent,
    requestId: r.request_id,
  };
}

// ── Filter helpers ──────────────────────────────────────────────────

/** Distinct action strings present in the log, capped at 200 for the dropdown. */
export async function listAuditActions(): Promise<string[]> {
  const caller = await requireSessionUser();
  if (
    !(await can(caller, "audit.view", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }
  const rows = await db
    .selectDistinct({ action: auditLog.action })
    .from(auditLog)
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
  const rows = await db
    .selectDistinct({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(auditLog)
    .innerJoin(users, eq(users.id, auditLog.actorId))
    .where(isNotNull(auditLog.actorId))
    .limit(200);

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
