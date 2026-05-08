import { db } from "./db/client";
import { auditLog } from "./db/schema/audit";
import { getActiveImpersonation } from "./auth/session";

type AuditEntry = {
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
  userAgent?: string;
  impersonatorId?: string | null;
  actorRoleSnapshot?: string | null;
  requestId?: string;
};

/**
 * Append an entry to the audit log. Every privileged Server Action and
 * Route Handler that successfully changes state must call this.
 *
 * Conventions:
 * - Action names use `domain.verb` format (`ticket.assign`, `user.deactivate`).
 * - `before` / `after` are JSON snapshots of the fields that changed only.
 * - Failures (auth/validation) are NOT audited — they're logged via Pino.
 *
 * Impersonation: callers don't need to plumb `impersonatorId` through.
 * If the request is in an active impersonation context, this helper
 * stamps the real admin's id automatically. Callers can still pass an
 * explicit `impersonatorId` to override (e.g. for system-side writes).
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
  await db.insert(auditLog).values({
    actorId: entry.actorId,
    actorRoleSnapshot: entry.actorRoleSnapshot ?? null,
    impersonatorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    beforeValue: entry.before as object | undefined,
    afterValue: entry.after as object | undefined,
    ipAddress: entry.ipAddress,
    userAgent: entry.userAgent,
    requestId: entry.requestId,
  });
}
