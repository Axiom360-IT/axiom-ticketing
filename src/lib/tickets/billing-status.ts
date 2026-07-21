// Derives a ticket's billing status from its billable category + invoice
// number. Pure + dependency-free so it can run on the server (queries) and in
// client badges alike.
//
//   billed        → an invoice number has been keyed in.
//   needs_invoice → a billable-by-invoice ticket that hasn't been invoiced yet
//                   (the ones to chase).
//   na            → nothing to invoice: monthly-plan (covered by the plan),
//                   non-billable, rework, or uncategorised.

export type BillingStatus = "billed" | "needs_invoice" | "na";

// Billable categories that are invoiced separately (so they CAN be "waiting to
// be billed"). Monthly-plan is drawn from the org's balance; no/rework/unset
// never get an invoice.
const INVOICEABLE = new Set(["yes", "project"]);

export function billingStatus(
  billable: string | null | undefined,
  invoiceNumber: string | null | undefined,
): BillingStatus {
  if (invoiceNumber && invoiceNumber.trim().length > 0) return "billed";
  if (billable && INVOICEABLE.has(billable)) return "needs_invoice";
  return "na";
}

// The values the /admin/tickets "Billing" filter offers (a flat multi-select;
// selecting several ORs them together, like the Status filter). Two are derived
// invoice states (needs_invoice / billed); the rest are the raw billable
// categories, plus "unset" for un-triaged tickets. Pure (no drizzle) so both the
// client filter UI and the server query can share this single source of truth.
export const BILLING_FILTER_VALUES = [
  "needs_invoice",
  "billed",
  "yes",
  "monthly_plan",
  "project",
  "rework",
  "no",
  "unset",
] as const;

export type BillingFilterValue = (typeof BILLING_FILTER_VALUES)[number];
