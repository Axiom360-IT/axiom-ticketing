import "server-only";
import { desc, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { emailDeliveryIssues } from "@/lib/db/schema/email-delivery";
import { isUndefinedTable } from "@/lib/db/pg-errors";
import { isNoReplyAddress } from "./automated-address";
import { type IssueRecord, type IssueStatus, reconcile } from "./delivery-state";
import { listEmailsSince, resendConfigured } from "./resend-log";

// ── Keeping email_delivery_issues in step with Resend ─────────────────

export type SyncResult = {
  scanned: number;
  opened: number;
  resolved: number;
  /** True when the scan ran out of pages before reaching its cutoff. */
  truncated: boolean;
};

const HOUR = 3_600_000;

export const ROUTINE_WINDOW = { hours: 12, pages: 5 } as const;
/** First run after install: look back far enough to find problems that were
 *  already there, which is the whole reason for installing this. */
export const BACKFILL_WINDOW = { hours: 24 * 14, pages: 30 } as const;

export async function syncDeliveryIssues(
  window: { hours: number; pages: number } = ROUTINE_WINDOW,
): Promise<SyncResult | { skipped: string }> {
  if (!resendConfigured()) return { skipped: "RESEND_API_KEY is not set" };

  const { emails, truncated } = await listEmailsSince(
    Date.now() - window.hours * HOUR,
    window.pages,
  );

  const rows = await db.select().from(emailDeliveryIssues);
  const known = new Map<string, IssueRecord>(
    rows.map((r) => [
      r.email,
      {
        email: r.email,
        status: r.status as IssueStatus,
        firstSeenAt: r.firstSeenAt,
        lastSeenAt: r.lastSeenAt,
        lastEmailId: r.lastEmailId,
        lastSubject: r.lastSubject,
        resolvedAt: r.resolvedAt,
      },
    ]),
  );

  const changes = reconcile(emails, known);
  for (const c of changes) {
    await db
      .insert(emailDeliveryIssues)
      .values(c)
      .onConflictDoUpdate({
        target: emailDeliveryIssues.email,
        set: {
          status: c.status,
          firstSeenAt: c.firstSeenAt,
          lastSeenAt: c.lastSeenAt,
          lastEmailId: c.lastEmailId,
          lastSubject: c.lastSubject,
          resolvedAt: c.resolvedAt,
        },
      });
  }

  return {
    scanned: emails.length,
    opened: changes.filter((c) => c.resolvedAt === null).length,
    resolved: changes.filter((c) => c.resolvedAt !== null).length,
    truncated,
  };
}

/** Has the monitor ever completed a run? Decides routine window vs. backfill. */
export async function hasSyncedBefore(): Promise<boolean> {
  try {
    const rows = await db.execute(sql`
      SELECT 1 FROM automation_runs
      WHERE automation_id = 'email-delivery-monitor' AND status = 'ok' LIMIT 1`);
    return rows.rows.length > 0;
  } catch {
    return false;
  }
}

// ── Reading, for the pages ────────────────────────────────────────────

export type DeliveryIssueView = {
  email: string;
  status: IssueStatus;
  since: Date;
  lastSeenAt: Date;
  lastSubject: string | null;
  lastEmailId: string | null;
};

/**
 * The OPEN issues among these addresses.
 *
 * Never throws. This runs on the ticket page and the user page, which are two
 * of the most used screens in the product, and an informational banner must
 * not be able to take either down: a missing table (before the migration), a
 * database blip, anything — the answer is "none known", and the page renders.
 */
export async function openIssuesFor(
  addresses: readonly string[],
): Promise<DeliveryIssueView[]> {
  // A no-reply mailbox is not a person who is missing their email. Monitoring
  // tools' alerts become tickets whose "customer" is one of these; a warning
  // that the robot "isn't receiving our emails" would be accurate and useless,
  // and we no longer send to them anyway (see send-guard.ts).
  const list = [
    ...new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean)),
  ].filter((a) => !isNoReplyAddress(a));
  if (list.length === 0) return [];
  try {
    const rows = await db
      .select()
      .from(emailDeliveryIssues)
      .where(inArray(emailDeliveryIssues.email, list))
      .orderBy(desc(emailDeliveryIssues.lastSeenAt));
    return rows
      .filter((r) => r.resolvedAt === null)
      .map((r) => ({
        email: r.email,
        status: r.status as IssueStatus,
        since: r.firstSeenAt,
        lastSeenAt: r.lastSeenAt,
        lastSubject: r.lastSubject,
        lastEmailId: r.lastEmailId,
      }));
  } catch (err) {
    if (!isUndefinedTable(err)) {
      console.error("[email-delivery] could not read issues:", err);
    }
    return [];
  }
}

/** True when this address currently has an open issue — the gate for the
 *  test-email button, so it can only be pointed at an address already known to
 *  be blocked and never used to mail arbitrary strangers. */
export async function hasOpenIssue(email: string): Promise<boolean> {
  return (await openIssuesFor([email])).length > 0;
}

