import "server-only";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { emailDeliveryIssues } from "@/lib/db/schema/email-delivery";
import { isNoReplyAddress } from "./automated-address";

// ── Who we should not even try to email ───────────────────────────────
//
// Two cases, both about not wasting sends that cannot arrive:
//
//   • a no-reply mailbox — nobody reads it; every send is a certain bounce
//   • an address that has HARD-BOUNCED or complained recently — the recipient's
//     own server has told us it will not take our mail
//
// Retrying either one only damages the sending reputation that every real
// customer's mail depends on.
//
// NOT covered: an address Resend has merely SUPPRESSED. Resend already refuses
// those itself, so a send costs us nothing, and — more to the point — skipping
// them here would stop a fixed address from ever proving it is fixed.
//
// The bounce rule expires after a week so that a mailbox which was full or
// temporarily misconfigured gets another chance on its own, instead of being
// written off forever by one bad day.

export const BOUNCE_COOLDOWN_DAYS = 7;

export async function skipReasonFor(to: string): Promise<string | null> {
  if (isNoReplyAddress(to)) return "no-reply address";

  try {
    const cutoff = new Date(Date.now() - BOUNCE_COOLDOWN_DAYS * 24 * 3_600_000);
    const rows = await db
      .select({ status: emailDeliveryIssues.status })
      .from(emailDeliveryIssues)
      .where(
        and(
          eq(emailDeliveryIssues.email, to.trim().toLowerCase()),
          isNull(emailDeliveryIssues.resolvedAt),
          inArray(emailDeliveryIssues.status, ["bounced", "complained"]),
          gt(emailDeliveryIssues.lastSeenAt, cutoff),
        ),
      )
      .limit(1);
    return rows[0] ? `recent ${rows[0].status} (retries after ${BOUNCE_COOLDOWN_DAYS} days)` : null;
  } catch {
    // The guard is an optimisation. If it cannot be evaluated, SEND — a missed
    // customer email is far worse than a wasted one.
    return null;
  }
}
