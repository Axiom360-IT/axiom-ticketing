import { eq, sql } from "drizzle-orm";
import { eventType } from "inngest";
import { getAccountantRecipients } from "@/lib/billing/accountants";
import { deriveBillingOutcome } from "@/lib/billing/outcome";
import { db } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema/organizations";
import { tickets } from "@/lib/db/schema/tickets";
import { workLogs } from "@/lib/db/schema/work-logs";
import { sendEmail } from "@/lib/email/send";
import { getAppUrl } from "@/lib/request";
import { inngest } from "../client";

// Accountant billing summary on ticket resolution (req 8.9). Emails the
// configured accountants (+ optional Superadmin copy) the derived billing
// outcome so they can act. To avoid noise we skip purely non-billable outcomes
// ("nothing to bill"); billed / pending / needs-review all notify.

function hoursLabel(minutes: number): string {
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

export const notifyAccountantResolved = inngest.createFunction(
  {
    id: "notify-accountant-resolved",
    triggers: eventType("billing/ticket.resolved"),
  },
  async ({ event, step }) => {
    const ticketId = event.data.ticketId;

    const data = await step.run("load", async () => {
      const [ticket] = await db
        .select({
          ticketNumber: tickets.ticketNumber,
          billable: tickets.billable,
          organizationId: tickets.organizationId,
        })
        .from(tickets)
        .where(eq(tickets.id, ticketId))
        .limit(1);
      if (!ticket) return null;

      let orgName: string | null = null;
      let isMonthlyPlan = false;
      let balanceMinutes: number | null = null;
      if (ticket.organizationId) {
        const [org] = await db
          .select({
            name: organizations.name,
            isMonthlyPlan: organizations.isMonthlyPlan,
            balance: organizations.monthlyMinutesBalance,
          })
          .from(organizations)
          .where(eq(organizations.id, ticket.organizationId))
          .limit(1);
        if (org) {
          orgName = org.name;
          isMonthlyPlan = org.isMonthlyPlan;
          balanceMinutes = org.balance;
        }
      }

      const [{ total }] = await db
        .select({ total: sql<number>`coalesce(sum(${workLogs.minutes}), 0)::int` })
        .from(workLogs)
        .where(eq(workLogs.ticketId, ticketId));

      return {
        ticketNumber: ticket.ticketNumber,
        billable: ticket.billable,
        orgName,
        isMonthlyPlan,
        balanceMinutes,
        totalMinutes: Number(total) || 0,
      };
    });

    if (!data) return { sent: 0, reason: "ticket-not-found" };

    const outcome = deriveBillingOutcome({
      billable: data.billable,
      isMonthlyPlan: data.isMonthlyPlan,
      balanceMinutes: data.balanceMinutes,
    });

    // Nothing to bill (non-billable / rework) — no accountant action needed.
    if (outcome.status === "none") {
      return { sent: 0, reason: "nothing-to-bill" };
    }

    const recipients = await step.run("recipients", async () =>
      getAccountantRecipients(),
    );
    if (recipients.emails.length === 0) {
      return { sent: 0, reason: "no-recipients" };
    }

    await step.run("email", async () => {
      const appUrl = getAppUrl();
      const ticketUrl = `${appUrl}/admin/tickets/${ticketId}`;
      // "none" is the ICU sentinel for "no overage" in the status message.
      const overHours =
        outcome.overplanMinutes > 0
          ? hoursLabel(outcome.overplanMinutes)
          : "none";
      for (const to of recipients.emails) {
        try {
          await sendEmail({
            to,
            template: {
              template: "accountant_ticket_billing",
              data: {
                ticketNumber: data.ticketNumber,
                orgName: data.orgName ?? "—",
                category: outcome.category,
                hours: hoursLabel(data.totalMinutes),
                overHours,
                status: outcome.status,
                ticketUrl,
              },
            },
            ticketNumber: data.ticketNumber,
          });
        } catch (err) {
          console.error("[notify-accountant-resolved] email failed:", err);
        }
      }
    });

    return { sent: recipients.emails.length, status: outcome.status };
  },
);
