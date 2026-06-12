import {
  inngest,
  type NotificationDispatchPayload,
} from "@/inngest/client";

/**
 * Fire the staff "a new ticket arrived" notification to Coordinators, IT
 * Directors and Super Admins on email + SMS + in-app. Each recipient's
 * email/SMS legs are gated by their own `notification_preferences` (default
 * on); in-app is always inserted. Best-effort by convention — every caller
 * wraps this in try/catch so a dispatch failure never fails ticket creation.
 *
 * Used by every customer-originated create path (portal, guest web form,
 * inbound email) so no incoming ticket sits unseen in the queue.
 */
export async function dispatchTicketCreated(args: {
  ticketId: string;
  ticketNumber: string;
  customerName: string;
  subject: string;
  appUrl: string;
}): Promise<void> {
  const { ticketId, ticketNumber, customerName, subject, appUrl } = args;
  const adminUrl = `${appUrl}/admin/tickets/${ticketId}`;

  const data: NotificationDispatchPayload = {
    type: "ticket.created",
    recipientRoles: ["Coordinator", "IT Director", "Super Admin"],
    email: {
      template: {
        template: "ticket_created_staff",
        data: { ticketNumber, customerName, subject, adminUrl },
      },
      ticketNumber,
    },
    sms: {
      template: {
        template: "ticket_created",
        data: { ticketNumber, ticketUrl: adminUrl },
      },
    },
    inApp: {
      titleArgs: { ticketNumber },
      bodyArgs: { customerName, subject },
      linkUrl: `/admin/tickets/${ticketId}`,
    },
  };

  await inngest.send({ name: "notification/dispatch", data });
}
