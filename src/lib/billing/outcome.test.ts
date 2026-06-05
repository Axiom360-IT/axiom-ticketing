import { describe, expect, it } from "vitest";
import { deriveBillingOutcome } from "./outcome";

describe("deriveBillingOutcome", () => {
  it("Non-Billable → nothing to bill", () => {
    expect(
      deriveBillingOutcome({ billable: "no", isMonthlyPlan: false, balanceMinutes: null }),
    ).toEqual({ status: "none", category: "no", overplanMinutes: 0 });
  });

  it("Rework → nothing to bill", () => {
    expect(
      deriveBillingOutcome({ billable: "rework", isMonthlyPlan: true, balanceMinutes: 100 }),
    ).toEqual({ status: "none", category: "rework", overplanMinutes: 0 });
  });

  it("Project → pending (needs invoicing)", () => {
    expect(
      deriveBillingOutcome({ billable: "project", isMonthlyPlan: false, balanceMinutes: null }),
    ).toEqual({ status: "pending", category: "project", overplanMinutes: 0 });
  });

  it("Billable (yes) → pending", () => {
    expect(
      deriveBillingOutcome({ billable: "yes", isMonthlyPlan: true, balanceMinutes: 50 }),
    ).toEqual({ status: "pending", category: "yes", overplanMinutes: 0 });
  });

  it("Monthly Support within balance → billed (covered)", () => {
    expect(
      deriveBillingOutcome({ billable: "monthly_plan", isMonthlyPlan: true, balanceMinutes: 120 }),
    ).toEqual({ status: "billed", category: "monthly_plan", overplanMinutes: 0 });
  });

  it("Monthly Support exactly at zero balance → still billed (not over)", () => {
    expect(
      deriveBillingOutcome({ billable: "monthly_plan", isMonthlyPlan: true, balanceMinutes: 0 }),
    ).toEqual({ status: "billed", category: "monthly_plan", overplanMinutes: 0 });
  });

  it("Monthly Support over plan (negative) → pending with overplan minutes", () => {
    expect(
      deriveBillingOutcome({ billable: "monthly_plan", isMonthlyPlan: true, balanceMinutes: -90 }),
    ).toEqual({ status: "pending", category: "monthly_plan", overplanMinutes: 90 });
  });

  it("Monthly Support tag on a NON-plan org → needs review", () => {
    expect(
      deriveBillingOutcome({ billable: "monthly_plan", isMonthlyPlan: false, balanceMinutes: null }),
    ).toEqual({ status: "review", category: "monthly_plan", overplanMinutes: 0 });
  });

  it("Uncategorized (null) → needs review", () => {
    expect(
      deriveBillingOutcome({ billable: null, isMonthlyPlan: true, balanceMinutes: 10 }),
    ).toEqual({ status: "review", category: "uncategorized", overplanMinutes: 0 });
  });

  it("Unknown billable string → treated as uncategorized review", () => {
    expect(
      deriveBillingOutcome({ billable: "weird", isMonthlyPlan: false, balanceMinutes: null }),
    ).toEqual({ status: "review", category: "uncategorized", overplanMinutes: 0 });
  });
});
