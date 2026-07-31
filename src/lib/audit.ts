import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { auditLog } from "./db/schema/audit";
import { users } from "./db/schema/auth";
import { organizations } from "./db/schema/organizations";
import { procurementRequests } from "./db/schema/procurement";
import { roles } from "./db/schema/rbac";
import { tickets } from "./db/schema/tickets";
import { getActiveImpersonation } from "./auth/session";
import {
  type AuditOutcome,
  auditActionCategory,
  auditSeverity,
} from "./audit/action-label";

type AuditEntry = {
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  /** Human-readable target label snapshot (ticket subject, org/user name). */
  targetLabel?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string | null;
  impersonatorId?: string | null;
  actorRoleSnapshot?: string | null;
  requestId?: string;
  /** Defaults to "success"; use "denied"/"failure"/"error" to record a blocked
   *  or failed privileged attempt in the same stream. */
  outcome?: AuditOutcome;
  failureReason?: string | null;
  /** Optional explicit identity snapshots — else looked up from `users`. */
  actorName?: string | null;
  actorEmail?: string | null;
};

async function userSnapshot(
  id: string | null,
): Promise<{ name: string | null; email: string | null }> {
  if (!id) return { name: null, email: null };
  try {
    const [row] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return { name: row?.name ?? null, email: row?.email ?? null };
  } catch {
    return { name: null, email: null };
  }
}

/**
 * Best-effort human-readable snapshot of the target, keyed by the same
 * targetType/targetId every caller already passes — so callers that don't
 * bother with `targetLabel` still get a searchable, display-friendly label
 * (ticket subject, org/user/role name, procurement item) captured AT WRITE
 * TIME. That's what keeps an entry findable/readable even if the underlying
 * row is later hard-deleted (rare — tickets/orgs/users are soft-deleted in
 * the normal case, so this mostly future-proofs the edge case).
 *
 * Ticket target_id is the ticket NUMBER (not its uuid) by convention across
 * every ticket.* audit call — see app/actions/tickets.ts.
 */
async function targetLabelSnapshot(
  targetType: string | undefined,
  targetId: string | undefined,
): Promise<string | null> {
  if (!targetType || !targetId) return null;
  try {
    switch (targetType) {
      case "ticket": {
        const [row] = await db
          .select({ subject: tickets.subject })
          .from(tickets)
          .where(eq(tickets.ticketNumber, targetId))
          .limit(1);
        return row?.subject ?? null;
      }
      case "organization": {
        const [row] = await db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, targetId))
          .limit(1);
        return row?.name ?? null;
      }
      case "user": {
        const [row] = await db
          .select({ name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, targetId))
          .limit(1);
        return row ? `${row.name} (${row.email})` : null;
      }
      case "role": {
        const [row] = await db
          .select({ name: roles.name })
          .from(roles)
          .where(eq(roles.id, targetId))
          .limit(1);
        return row?.name ?? null;
      }
      case "procurement": {
        const [row] = await db
          .select({ itemName: procurementRequests.itemName })
          .from(procurementRequests)
          .where(eq(procurementRequests.id, targetId))
          .limit(1);
        return row?.itemName ?? null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Append an entry to the audit log. Every privileged Server Action and
 * Route Handler that changes state (or denies/fails a privileged attempt)
 * should call this.
 *
 * Conventions:
 * - Action names use `domain.verb` format (`ticket.assign`, `user.deactivate`).
 * - `before` / `after` are JSON snapshots of the fields that changed only.
 * - `outcome` defaults to "success"; pass "denied"/"failure"/"error" to record
 *   a blocked attempt in the same queryable stream.
 *
 * Identity is SNAPSHOTTED (actor/impersonator name + email) at write time so a
 * record stays attributable even if the user is later removed. Category and
 * severity are derived from the action. Impersonation is auto-stamped from the
 * active impersonation context unless an explicit `impersonatorId` is passed.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  let impersonatorId = entry.impersonatorId ?? null;
  if (impersonatorId === null && entry.actorId !== null) {
    try {
      const imp = await getActiveImpersonation();
      if (imp) impersonatorId = imp.impersonatorId;
    } catch {
      // Outside a request context (e.g. Inngest cron) — skip cookie lookup.
    }
  }

  const outcome = entry.outcome ?? "success";
  const [actorSnap, impSnap, targetLabel] = await Promise.all([
    entry.actorName !== undefined || entry.actorEmail !== undefined
      ? Promise.resolve({
          name: entry.actorName ?? null,
          email: entry.actorEmail ?? null,
        })
      : userSnapshot(entry.actorId),
    userSnapshot(impersonatorId),
    // Only auto-derive when the caller didn't pass one at all — an explicit
    // `null` (or a real string) is honored as-is, no lookup.
    entry.targetLabel !== undefined
      ? Promise.resolve(entry.targetLabel)
      : targetLabelSnapshot(entry.targetType, entry.targetId),
  ]);

  await db.insert(auditLog).values({
    actorId: entry.actorId,
    actorName: actorSnap.name,
    actorEmail: actorSnap.email,
    actorRoleSnapshot: entry.actorRoleSnapshot ?? null,
    impersonatorId,
    impersonatorName: impSnap.name,
    impersonatorEmail: impSnap.email,
    action: entry.action,
    category: auditActionCategory(entry.action),
    severity: auditSeverity(entry.action, outcome),
    outcome,
    failureReason: entry.failureReason ?? null,
    targetType: entry.targetType,
    targetId: entry.targetId,
    targetLabel,
    sessionId: entry.sessionId ?? null,
    beforeValue: entry.before as object | undefined,
    afterValue: entry.after as object | undefined,
    ipAddress: entry.ipAddress,
    userAgent: entry.userAgent,
    requestId: entry.requestId,
  });
}
