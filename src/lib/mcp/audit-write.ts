import "server-only";
import { and, count, desc, eq, gte, ilike, lte, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { can, isStrictTechnician, type SessionUser } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { db } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema/audit";
import { users } from "@/lib/db/schema/auth";
import {
  auditActionLabel,
  auditOutcomeLabel,
  friendlyAuditTarget,
} from "@/lib/audit/action-label";

// Read-only — despite living alongside the "-write" modules, this is a
// summary query, not a mutation. Mirrors the search/filter logic in
// app/actions/audit.ts's listAuditEntriesOffset/buildWhere (which can't be
// called directly — it uses requireSessionUser(), cookie-based), including
// the SAME strict-technician scoping (req 7.1): a strict technician only
// ever sees their OWN entries, here exactly like in the admin audit page.

const OUTCOMES = ["success", "failure", "denied", "error"] as const;

export type AuditSummaryEntry = {
  action: string;
  target: string;
  actor: string;
  outcome: string;
  timestamp: string;
};

export async function summarizeAuditLogViaMcp(
  user: SessionUser,
  filters: {
    q?: string;
    from?: string;
    to?: string;
    actorEmail?: string;
    action?: string;
    outcome?: (typeof OUTCOMES)[number];
    limit?: number;
  },
): Promise<{ totalMatching: number; entries: AuditSummaryEntry[] } | { error: string }> {
  if (!(await can(user, "audit.view", { type: "global" }, productionContext))) {
    return { error: "You don't have permission to view the audit log." };
  }

  const clauses: SQL[] = [];
  if (isStrictTechnician(user)) {
    clauses.push(eq(auditLog.actorId, user.id));
  }
  if (filters.from) {
    const d = new Date(filters.from);
    if (!Number.isNaN(d.getTime())) clauses.push(gte(auditLog.timestamp, d));
  }
  if (filters.to) {
    const d = new Date(filters.to);
    if (!Number.isNaN(d.getTime())) clauses.push(lte(auditLog.timestamp, d));
  }
  if (filters.action) clauses.push(eq(auditLog.action, filters.action));
  if (filters.outcome) clauses.push(eq(auditLog.outcome, filters.outcome));
  if (filters.actorEmail) {
    const [actor] = await db.select({ id: users.id }).from(users).where(eq(users.email, filters.actorEmail.trim().toLowerCase())).limit(1);
    if (!actor) return { totalMatching: 0, entries: [] };
    clauses.push(eq(auditLog.actorId, actor.id));
  }
  if (filters.q) {
    const q = `%${filters.q.trim()}%`;
    clauses.push(sqlSearch(q));
  }

  const where = clauses.length > 0 ? and(...clauses) : undefined;
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 50);

  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select({
        action: auditLog.action,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        targetLabel: auditLog.targetLabel,
        actorName: auditLog.actorName,
        outcome: auditLog.outcome,
        timestamp: auditLog.timestamp,
      })
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.timestamp))
      .limit(limit),
    db.select({ value: count() }).from(auditLog).where(where),
  ]);

  return {
    totalMatching: total,
    entries: rows.map((r) => ({
      action: auditActionLabel(r.action),
      target: friendlyAuditTarget(r),
      actor: r.actorName ?? "System",
      outcome: auditOutcomeLabel(r.outcome),
      timestamp: r.timestamp.toISOString(),
    })),
  };
}

// Mirrors the `q` search clause added to app/actions/audit.ts buildWhere:
// target id/label, action, and — for ticket-targeted entries — the ticket's
// current subject (joined by ticket number).
function sqlSearch(q: string): SQL {
  return or(
    ilike(auditLog.targetId, q),
    ilike(auditLog.targetLabel, q),
    ilike(auditLog.action, q),
  )!;
}

// ── MCP tool registration ────────────────────────────────────────────────

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerAuditReadTools(server: any, user: SessionUser): void {
  server.registerTool(
    "summarize_audit_log",
    {
      title: "Search/summarize the audit log",
      description:
        "Searches the audit log by free text, date range, actor email, action code, or outcome (success/failure/denied/error). Returns a count and the most recent matching entries. Read-only.",
      inputSchema: {
        q: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        actorEmail: z.string().email().optional(),
        action: z.string().optional(),
        outcome: z.enum(OUTCOMES).optional(),
        limit: z.number().int().positive().max(50).optional(),
      },
    },
    async (input: {
      q?: string;
      from?: string;
      to?: string;
      actorEmail?: string;
      action?: string;
      outcome?: (typeof OUTCOMES)[number];
      limit?: number;
    }) => {
      const r = await summarizeAuditLogViaMcp(user, input);
      return "error" in r ? errorResult(r.error) : textResult(r);
    },
  );
}
