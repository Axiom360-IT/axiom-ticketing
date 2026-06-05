import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema/organizations";
import { tickets } from "@/lib/db/schema/tickets";
import { workLogs } from "@/lib/db/schema/work-logs";

// ── Monthly-Plan hour deduction (Meeting-2, CR-19) ────────────────────
//
// Keeps a ticket's deduction against its organization's Monthly-Plan balance
// in sync. Idempotent: it computes how many work-log minutes SHOULD currently
// be deducted for the ticket and only applies the delta versus what was
// already deducted (tracked on `tickets.monthly_plan_deducted_minutes`). That
// makes it safe to call after any change that affects the figure — a work-log
// added/removed, or the `billable` field toggled to/from 'monthly_plan'.
//
// Must run inside a transaction so the balance and the tracking column move
// together.
// ──────────────────────────────────────────────────────────────────────

// Returns the organization id whose Monthly-Plan balance was changed (so the
// caller can emit `billing/balance.changed` AFTER the transaction commits — the
// balance monitor must read the committed value, req 8.6), or null when nothing
// changed / the ticket has no org.
export async function syncMonthlyPlanDeduction(
  tx: Tx,
  ticketId: string,
): Promise<string | null> {
  const [t] = await tx
    .select({
      billable: tickets.billable,
      organizationId: tickets.organizationId,
      deducted: tickets.monthlyPlanDeductedMinutes,
    })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!t) return null;

  let orgIsMonthlyPlan = false;
  if (t.organizationId) {
    const [org] = await tx
      .select({ isMonthlyPlan: organizations.isMonthlyPlan })
      .from(organizations)
      .where(eq(organizations.id, t.organizationId))
      .limit(1);
    orgIsMonthlyPlan = Boolean(org?.isMonthlyPlan);
  }

  const [{ total }] = await tx
    .select({
      total: sql<number>`coalesce(sum(${workLogs.minutes}), 0)`,
    })
    .from(workLogs)
    .where(eq(workLogs.ticketId, ticketId));

  // Only deduct when the ticket is billed as Monthly Plan AND its org is on a
  // monthly plan. Otherwise the target is 0 — which also refunds any prior
  // deduction if the ticket was previously Monthly Plan.
  const shouldDeduct =
    t.billable === "monthly_plan" && t.organizationId && orgIsMonthlyPlan
      ? Number(total)
      : 0;
  const delta = shouldDeduct - t.deducted;
  if (delta === 0) return null;

  await tx
    .update(tickets)
    .set({ monthlyPlanDeductedMinutes: shouldDeduct })
    .where(eq(tickets.id, ticketId));

  if (t.organizationId) {
    await tx
      .update(organizations)
      .set({
        monthlyMinutesBalance: sql`coalesce(${organizations.monthlyMinutesBalance}, 0) - ${delta}`,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, t.organizationId));
    return t.organizationId;
  }

  return null;
}
