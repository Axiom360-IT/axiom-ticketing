import { eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { tickets } from "@/lib/db/schema/tickets";
import type { BillingFilterValue } from "./billing-status";

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
          sql`${tickets.billable} in ('yes','project') and (${tickets.invoiceNumber} is null or ${tickets.invoiceNumber} = '')`,
        );
        break;
      case "unset":
        preds.push(isNull(tickets.billable));
        break;
      case "yes":
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
