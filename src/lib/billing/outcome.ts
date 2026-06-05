// Derive the billing outcome reported to the accountant when a ticket is
// resolved (req 8.9), from the ticket's category + the org's plan state. Pure
// (no IO) so it's unit-testable.
//
// status:
//   billed   — fully covered, no action needed (Monthly Support within the plan)
//   pending  — an amount is still pending / needs invoicing (Project, Billable,
//              or Monthly-Support hours that ran over the plan)
//   none     — nothing to bill (Non-Billable, Rework)
//   review   — needs attention before it can be billed (uncategorized, or
//              tagged Monthly Support on an org with no monthly plan)

export type BillingStatus = "billed" | "pending" | "none" | "review";

export type BillingCategory =
  | "monthly_plan"
  | "project"
  | "rework"
  | "yes"
  | "no"
  | "uncategorized";

export type BillingOutcomeInput = {
  billable: string | null;
  /** Whether the ticket's organization is on a monthly plan. */
  isMonthlyPlan: boolean;
  /** The org's CURRENT (post-deduction) Monthly-Plan balance, in minutes. */
  balanceMinutes: number | null;
};

export type BillingOutcome = {
  status: BillingStatus;
  category: BillingCategory;
  /** For over-plan Monthly Support, how many minutes are over (else 0). */
  overplanMinutes: number;
};

function toCategory(billable: string | null): BillingCategory {
  switch (billable) {
    case "monthly_plan":
    case "project":
    case "rework":
    case "yes":
    case "no":
      return billable;
    default:
      return "uncategorized";
  }
}

export function deriveBillingOutcome(
  input: BillingOutcomeInput,
): BillingOutcome {
  const category = toCategory(input.billable);

  switch (category) {
    case "no":
    case "rework":
      return { status: "none", category, overplanMinutes: 0 };

    case "project":
    case "yes":
      return { status: "pending", category, overplanMinutes: 0 };

    case "monthly_plan": {
      if (!input.isMonthlyPlan) {
        // Tagged Monthly Support but the org has no plan — nothing was
        // deducted; an accountant should reconcile.
        return { status: "review", category, overplanMinutes: 0 };
      }
      const balance = input.balanceMinutes ?? 0;
      if (balance < 0) {
        return { status: "pending", category, overplanMinutes: -balance };
      }
      return { status: "billed", category, overplanMinutes: 0 };
    }

    default:
      // Uncategorized — the team hasn't decided how to bill it yet.
      return { status: "review", category: "uncategorized", overplanMinutes: 0 };
  }
}
