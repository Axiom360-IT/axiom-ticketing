import { db } from "./db/client";
import { auditLog } from "./db/schema/audit";

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
 */
export async function audit(entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actorId: entry.actorId,
    actorRoleSnapshot: entry.actorRoleSnapshot ?? null,
    impersonatorId: entry.impersonatorId ?? null,
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
