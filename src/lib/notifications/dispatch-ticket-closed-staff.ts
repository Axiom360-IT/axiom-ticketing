import {
  inngest,
  type NotificationDispatchPayload,
} from "@/inngest/client";

/**
 * Fire the staff "a ticket was closed" notification to Coordinators, IT
 * Directors and Super Admins on email + SMS + in-app (each leg gated by the
 * recipient's own `notification_preferences`; in-app always inserted). This is
 * the oversight copy — separate from the customer-facing `ticket.closed`.
 *
 * Best-effort by convention — every caller wraps it in try/catch so a dispatch
 * failure never blocks the close itself.
 */
export async function dispatchTicketClosedStaff(args: {
  ticketId: string;
  ticketNumber: string;
  subject: string;
  reason: "csat" | "auto";
  appUrl: string;
}): Promise<void> {
  const { ticketId, ticketNumber, subject, reason, appUrl } = args;
  const adminUrl = `${appUrl}/admin/tickets/${ticketId}`;

  const data: NotificationDispatchPayload = {
    type: "ticket.closed_staff",
    recipientRoles: ["Coordinator", "IT Director", "Super Admin"],
    email: {
      template: {
        template: "ticket_closed_staff",
        data: { ticketNumber, subject, reason, adminUrl },
      },
      ticketNumber,
    },
    sms: {
      template: {
        template: "ticket_closed_staff",
        data: { ticketNumber, ticketUrl: adminUrl },
      },
    },
    inApp: {
      titleArgs: { ticketNumber },
      bodyArgs: { subject },
      linkUrl: `/admin/tickets/${ticketId}`,
    },
  };

  await inngest.send({ name: "notification/dispatch", data });
}
