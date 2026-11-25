import {
  and,
  eq,
  isNotNull,
  isNull,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { tickets } from "@/lib/db/schema/tickets";
import type { BillingFilterValue } from "./billing-status";

// ── SLA filter ────────────────────────────────────────────────────────────
//
// `?sla=breached|at_risk` on /admin/tickets (and its export). The dashboard's
// "SLA deadlines" card counts tickets with `slaRadarCondition()`, and the list
// it links to filters with the SAME function, so the number on the card and the
// number of rows after clicking it cannot disagree.
export const SLA_FILTER_VALUES = ["breached", "at_risk"] as const;
export type SlaFilterValue = (typeof SLA_FILTER_VALUES)[number];

/**
 * In-flight tickets the SLA monitor has flagged, optionally narrowed to one
 * state. Visibility (`ticketsVisibilityCondition`) is the caller's job.
 *
 *   (no state)  breached OR in the 80% warning band — the card's whole radar
 *   breached    `sla_breached_at` is stamped
 *   at_risk     80% warning stamped, not yet breached
 *
 * The stamp columns persist after resolution, so resolved/closed are excluded
 * here. Paused tickets (awaiting customer / on hold) are off the SLA clock and
 * are excluded too, so waiting time is never reported as a breach.
 */
export function slaRadarCondition(state?: SlaFilterValue): SQL {
  const stateClause =
    state === "breached"
      ? isNotNull(tickets.slaBreachedAt)
      : state === "at_risk"
        ? and(isNotNull(tickets.slaWarning80At), isNull(tickets.slaBreachedAt))
        : or(isNotNull(tickets.slaBreachedAt), isNotNull(tickets.slaWarning80At));
  return and(
    notInArray(tickets.status, ["resolved", "closed"]),
    isNull(tickets.slaPausedAt),
    stateClause,
  ) as SQL;
}

// Maps the /admin/tickets "Billing" filter selections to a SQL predicate.
// Selecting several ORs them together (a ticket matching ANY chosen state is
// shown), mirroring how the Status / Priority multi-selects compose. Shared by
// the list page and the export route so both stay in lock-step.
//
// `values` are already validated against BILLING_FILTER_VALUES by the caller.
export function billingFilterCondition(
  values: readonly string[],
): SQL | undefined {
  const preds: SQL[] = [];
  for (const v of values as BillingFilterValue[]) {
    switch (v) {
      case "billed":
        preds.push(
          sql`${tickets.invoiceNumber} is not null and ${tickets.invoiceNumber} <> ''`,
        );
        break;
      case "needs_invoice":
        preds.push(
          sql`${tickets.billable} in ('hourly_regular','hourly_premium','project') and (${tickets.invoiceNumber} is null or ${tickets.invoiceNumber} = '')`,
        );
        break;
      case "unset":
        preds.push(isNull(tickets.billable));
        break;
      case "hourly_regular":
      case "hourly_premium":
      case "no":
      case "monthly_plan":
      case "project":
      case "rework":
        preds.push(eq(tickets.billable, v));
        break;
    }
  }
  if (preds.length === 0) return undefined;
  return preds.length === 1 ? preds[0] : or(...preds);
}
