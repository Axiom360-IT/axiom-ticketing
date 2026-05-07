import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { tickets } from "@/lib/db/schema/tickets";
import { sendEmail } from "@/lib/email/send";
import { signGuestToken, verifyCsatToken } from "@/lib/tokens";

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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

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

  // Notify the assigned tech (best-effort) so they know the customer pushed back.
  if (ticket.assignedToId) {
    try {
      const [tech] = await db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, ticket.assignedToId))
        .limit(1);
      if (tech) {
        await sendEmail({
          to: tech.email,
          template: {
            template: "new_assignment",
            data: {
              ticketNumber: ticket.ticketNumber,
              technicianName: tech.name,
              subject: ticket.subject,
              priority: "high",
              customerName: ticket.customerName,
              ticketUrl: `${appUrl}/admin/tickets/${ticket.id}`,
            },
          },
          ticketNumber: ticket.ticketNumber,
        });
      }
    } catch (err) {
      console.error("[csat/confirm] tech notification failed:", err);
    }
  }

  // Confirm to the customer that we've reopened.
  try {
    const guestToken = signGuestToken(ticket.ticketNumber, ticket.customerEmail);
    const trackingUrl = `${appUrl}/portal/tickets/${ticket.ticketNumber}?token=${guestToken}`;
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
