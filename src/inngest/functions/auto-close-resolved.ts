import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { cron } from "inngest";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema/tickets";
import { sendEmail } from "@/lib/email/send";
import { getAppUrl } from "@/lib/request";
import { inngest } from "../client";

// Hourly cron — finds tickets resolved more than 24h ago that the customer
// never confirmed via the CSAT email, closes them, and sends the
// ticket_closed email so the customer knows the loop is shut.
//
// Per ARCHITECTURE §7.2 / EXECUTION M3: actor=null on the audit entry to
// mark this as a system action.
export const autoCloseResolvedTickets = inngest.createFunction(
  {
    id: "auto-close-resolved-tickets",
    triggers: cron("0 * * * *"),
  },
  async ({ step }) => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const stale = await step.run("find-stale-resolved", async () => {
      return db
        .select({
          id: tickets.id,
          ticketNumber: tickets.ticketNumber,
          subject: tickets.subject,
          customerEmail: tickets.customerEmail,
          customerName: tickets.customerName,
          // Project the customer FK so we can route through the
          // dispatcher (per-prefs email + SMS + bell) for authenticated
          // customers and fall back to direct email for guests.
          customerId: tickets.customerId,
        })
        .from(tickets)
        .where(
          and(
            eq(tickets.status, "resolved"),
            isNull(tickets.csatResponse),
            lt(tickets.resolvedAt, cutoff),
          ),
        );
    });

    if (stale.length === 0) {
      return { closed: 0 };
    }

    const appUrl = getAppUrl();

    // Close each ticket in its own step so a single email failure can't roll
    // the whole batch back, and Inngest can retry just the failing ones.
    for (const t of stale) {
      await step.run(`close-${t.id}`, async () => {
        await db
          .update(tickets)
          .set({
            status: "closed",
            closedAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(tickets.id, t.id),
              eq(tickets.status, "resolved"),
              isNull(tickets.csatResponse),
            ),
          );

        await audit({
          actorId: null,
          action: "ticket.auto_close",
          targetType: "ticket",
          targetId: t.ticketNumber,
          before: { status: "resolved" },
          after: { status: "closed", reason: "csat_no_response_24h" },
        });
      });

      await step.run(`notify-${t.id}`, async () => {
        try {
          if (t.customerId) {
            // Dispatch fan-out so the customer's email + SMS + bell
            // preferences are honored on auto-close.
            await inngest.send({
              name: "notification/dispatch",
              data: {
                type: "ticket.closed",
                recipientUserIds: [t.customerId],
                ticketId: t.id,
                ticketNumber: t.ticketNumber,
                email: {
                  template: {
                    template: "ticket_closed",
                    data: {
                      ticketNumber: t.ticketNumber,
                      customerName: t.customerName,
                      subject: t.subject,
                      reason: "auto",
                      newTicketUrl: `${appUrl}/portal/submit`,
                    },
                  },
                  ticketNumber: t.ticketNumber,
                },
                sms: {
                  template: {
                    template: "ticket_closed",
                    data: {
                      ticketNumber: t.ticketNumber,
                      ticketUrl: `${appUrl}/portal/tickets/${t.ticketNumber}`,
                    },
                  },
                },
                inApp: {
                  titleArgs: { ticketNumber: t.ticketNumber },
                  bodyArgs: {
                    reason:
                      "Auto-closed after 24 hours without confirmation.",
                  },
                  linkUrl: `/portal/tickets/${t.ticketNumber}`,
                },
              },
            });
          } else {
            // Guest ticket — no customer_id, fall back to direct email.
            await sendEmail({
              to: t.customerEmail,
              template: {
                template: "ticket_closed",
                data: {
                  ticketNumber: t.ticketNumber,
                  customerName: t.customerName,
                  subject: t.subject,
                  reason: "auto",
                  newTicketUrl: `${appUrl}/portal/submit`,
                },
              },
              ticketNumber: t.ticketNumber,
            });
          }
        } catch (err) {
          console.error(
            `[auto-close-resolved-tickets] notify failed for ${t.ticketNumber}:`,
            err,
          );
        }
      });
    }

    return { closed: stale.length };
  },
);
