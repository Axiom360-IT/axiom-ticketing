import { eventType } from "inngest";
import { sendEmail, type EmailTemplate } from "@/lib/email/send";
import { inngest } from "../client";

// Receives a per-recipient notification/email child event from the
// dispatcher and calls our existing sendEmail wrapper. Inngest retries
// up to 3 times with exponential backoff on transient Resend errors.

type EventData = {
  to: string;
  locale: string;
  template: EmailTemplate;
  ticketNumber?: string;
  replyToTicket?: boolean;
};

export const sendEmailNotification = inngest.createFunction(
  {
    id: "send-email-notification",
    retries: 3,
    triggers: eventType("notification/email"),
  },
  async ({ event }) => {
    const d = event.data as EventData;
    await sendEmail({
      to: d.to,
      locale: d.locale,
      template: d.template,
      ticketNumber: d.ticketNumber,
      replyToTicket: d.replyToTicket,
    });
    return { ok: true };
  },
);
