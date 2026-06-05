import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { eventType } from "inngest";
import { getAccountantRecipients } from "@/lib/billing/accountants";
import { db } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema/organizations";
import { sendEmail } from "@/lib/email/send";
import { getAppUrl } from "@/lib/request";
import { sendSms } from "@/lib/sms/send";
import { inngest } from "../client";

// Over-plan (negative balance) accountant alert (req 8.6). Triggered after any
// Monthly-Plan balance change. De-duped so a negative episode alerts EXACTLY
// once: we atomically "claim" the alert by setting negative_balance_alerted_at
// only while it's still NULL and the balance is still negative; the winner of
// that claim sends. When the balance returns to >= 0 (top-up, reset) the flag
// is cleared so the next dip re-alerts.

function hours(minutes: number): string {
  const h = Math.abs(minutes) / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

function currentPeriod(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });
}

export const billingBalanceMonitor = inngest.createFunction(
  {
    id: "billing-balance-monitor",
    triggers: eventType("billing/balance.changed"),
  },
  async ({ event, step }) => {
    const organizationId = event.data.organizationId;

    // Atomically claim the alert (or clear a resolved one). Returns the org row
    // ONLY when this invocation just transitioned it into the alerted state.
    const claimed = await step.run("claim-alert", async () => {
      // Clear the flag if the balance has recovered, so a future dip re-alerts.
      await db
        .update(organizations)
        .set({ negativeBalanceAlertedAt: null })
        .where(
          and(
            eq(organizations.id, organizationId),
            isNotNull(organizations.negativeBalanceAlertedAt),
            sql`coalesce(${organizations.monthlyMinutesBalance}, 0) >= 0`,
          ),
        );

      // Claim: set the flag iff still negative AND not already alerted.
      const rows = await db
        .update(organizations)
        .set({ negativeBalanceAlertedAt: new Date() })
        .where(
          and(
            eq(organizations.id, organizationId),
            eq(organizations.isMonthlyPlan, true),
            isNull(organizations.negativeBalanceAlertedAt),
            lt(organizations.monthlyMinutesBalance, 0),
          ),
        )
        .returning({
          name: organizations.name,
          balance: organizations.monthlyMinutesBalance,
          included: organizations.monthlyMinutesIncluded,
        });
      return rows[0] ?? null;
    });

    if (!claimed) return { alerted: false };

    const recipients = await step.run("load-recipients", async () =>
      getAccountantRecipients(),
    );
    if (recipients.emails.length === 0 && recipients.phones.length === 0) {
      return { alerted: false, reason: "no-recipients" };
    }

    await step.run("notify", async () => {
      const appUrl = getAppUrl();
      const orgUrl = `${appUrl}/admin/organizations/${organizationId}`;
      const overHours = hours(claimed.balance ?? 0);
      const includedHours = hours(claimed.included ?? 0);
      const period = currentPeriod();

      for (const to of recipients.emails) {
        try {
          await sendEmail({
            to,
            template: {
              template: "accountant_negative_balance",
              data: {
                orgName: claimed.name,
                overHours,
                includedHours,
                period,
                orgUrl,
              },
            },
          });
        } catch (err) {
          console.error("[billing-balance-monitor] email failed:", err);
        }
      }
      for (const to of recipients.phones) {
        try {
          await sendSms({
            to,
            template: {
              template: "accountant_negative_balance",
              data: { orgName: claimed.name, overHours },
            },
          });
        } catch (err) {
          console.error("[billing-balance-monitor] sms failed:", err);
        }
      }
    });

    return { alerted: true };
  },
);
