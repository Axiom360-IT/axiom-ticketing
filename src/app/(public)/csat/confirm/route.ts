import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema/tickets";
import { sendEmail } from "@/lib/email/send";
import { getAppUrl } from "@/lib/request";
import { ticketTrackingUrl, verifyCsatToken } from "@/lib/tokens";
import { inngest } from "@/inngest/client";
import { dispatchTicketClosedStaff } from "@/lib/notifications/dispatch-ticket-closed-staff";

// One-click CSAT confirmation. The link in the resolved-email HMAC-encodes
// (ticketNumber, response) so a single GET is enough — no DB lookup is
// required to verify intent.
//
// Idempotent: if the customer already responded, we redirect to the same
// result page without changing state. Tampered or unknown tokens land on
// the result page with `status=invalid`.
export async function GET(request: NextRequest): Promise<Response> {
  const url = request.nextUrl;
  const ticketNumber = url.searchParams.get("t");
  const token = url.searchParams.get("tk");

  if (!ticketNumber || !token) {
    redirect("/csat/result?status=invalid");
  }

  const response = verifyCsatToken(token, ticketNumber);
  if (!response) {
    redirect("/csat/result?status=invalid");
  }

  const [ticket] = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      status: tickets.status,
      assignedToId: tickets.assignedToId,
      customerId: tickets.customerId,
      customerEmail: tickets.customerEmail,
      customerName: tickets.customerName,
      csatResponse: tickets.csatResponse,
    })
    .from(tickets)
    .where(eq(tickets.ticketNumber, ticketNumber))
    .limit(1);

  if (!ticket) {
    redirect("/csat/result?status=invalid");
  }

  // Already responded — idempotent redirect.
  if (ticket.csatResponse) {
    redirect(`/csat/result?status=already&response=${ticket.csatResponse}`);
  }

  // Only resolved tickets accept CSAT. If the ticket has moved on (e.g. a
  // new agent reply reopened it), don't roll the state back; just record
  // that the customer was unsatisfied so reports stay accurate.
  if (ticket.status !== "resolved") {
    await db
      .update(tickets)
      .set({
        csatResponse: response,
        csatRespondedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tickets.id, ticket.id));

    await audit({
      actorId: null,
      action: `ticket.csat.${response}`,
      targetType: "ticket",
      targetId: ticket.ticketNumber,
      after: { csatResponse: response, ticketStatus: ticket.status },
    });

    redirect(`/csat/result?status=ok&response=${response}`);
  }

  const appUrl = getAppUrl();

  if (response === "satisfied") {
    await db
      .update(tickets)
      .set({
        csatResponse: "satisfied",
        csatRespondedAt: new Date(),
        status: "closed",
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tickets.id, ticket.id));

    await audit({
      actorId: null,
      action: "ticket.csat.satisfied",
      targetType: "ticket",
      targetId: ticket.ticketNumber,
      before: { status: "resolved" },
      after: { status: "closed", csatResponse: "satisfied" },
    });

    try {
      await sendEmail({
        to: ticket.customerEmail,
        template: {
          template: "ticket_closed",
          data: {
            ticketNumber: ticket.ticketNumber,
            customerName: ticket.customerName,
            subject: ticket.subject,
            reason: "csat",
            newTicketUrl: `${appUrl}/portal/submit`,
          },
        },
        ticketNumber: ticket.ticketNumber,
      });
    } catch (err) {
      console.error("[csat/confirm] ticket_closed email failed:", err);
    }

    // Staff oversight notification that the ticket closed.
    try {
      await dispatchTicketClosedStaff({
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        reason: "csat",
        appUrl,
      });
    } catch (err) {
      console.error("[csat/confirm] staff close notification failed:", err);
    }

    redirect("/csat/result?status=ok&response=satisfied");
  }

  // unsatisfied — reopen
  const newStatus = ticket.assignedToId ? "in_progress" : "open";

  await db
    .update(tickets)
    .set({
      csatResponse: "unsatisfied",
      csatRespondedAt: new Date(),
      status: newStatus,
      resolvedAt: null,
      reopenedCount: sql`${tickets.reopenedCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(tickets.id, ticket.id));

  await audit({
    actorId: null,
    action: "ticket.csat.unsatisfied",
    targetType: "ticket",
    targetId: ticket.ticketNumber,
    before: { status: "resolved" },
    after: { status: newStatus, csatResponse: "unsatisfied" },
  });

  // Notify the assigned tech + Coordinator role so the team knows the
  // customer pushed back and the ticket is still not resolved. Goes
  // through the dispatcher so each recipient's email/SMS/bell prefs
  // are honored.
  try {
    await inngest.send({
      name: "notification/dispatch",
      data: {
        type: "ticket.csat_unsatisfied",
        recipientUserIds: ticket.assignedToId ? [ticket.assignedToId] : [],
        recipientRoles: ["Coordinator"],
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        email: {
          template: {
            template: "csat_unsatisfied_staff",
            data: {
              ticketNumber: ticket.ticketNumber,
              subject: ticket.subject,
              customerName: ticket.customerName,
              ticketUrl: `${appUrl}/admin/tickets/${ticket.id}`,
            },
          },
          ticketNumber: ticket.ticketNumber,
        },
        sms: {
          template: {
            template: "csat_unsatisfied_staff",
            data: {
              ticketNumber: ticket.ticketNumber,
              ticketUrl: `${appUrl}/admin/tickets/${ticket.id}`,
            },
          },
        },
        inApp: {
          titleArgs: { ticketNumber: ticket.ticketNumber },
          bodyArgs: { customerName: ticket.customerName },
          linkUrl: `/admin/tickets/${ticket.id}`,
        },
      },
    });
  } catch (err) {
    console.error("[csat/confirm] staff notification dispatch failed:", err);
  }

  // Confirm to the customer that we've reopened.
  try {
    const trackingUrl = ticketTrackingUrl({
      appUrl,
      ticketNumber: ticket.ticketNumber,
      customerEmail: ticket.customerEmail,
      customerId: ticket.customerId,
    });
    await sendEmail({
      to: ticket.customerEmail,
      template: {
        template: "ticket_reopened",
        data: {
          ticketNumber: ticket.ticketNumber,
          customerName: ticket.customerName,
          subject: ticket.subject,
          reason: "csat_unsatisfied",
          trackingUrl,
        },
      },
      ticketNumber: ticket.ticketNumber,
      replyToTicket: true,
    });
  } catch (err) {
    console.error("[csat/confirm] ticket_reopened email failed:", err);
  }

  redirect("/csat/result?status=ok&response=unsatisfied");
}
