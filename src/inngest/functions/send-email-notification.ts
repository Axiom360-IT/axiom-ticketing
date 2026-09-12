import { eventType, NonRetriableError } from "inngest";
import { isPermanentSendFailure } from "@/lib/notifications/permanent-failure";
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
    try {
      await sendEmail({
        to: d.to,
        locale: d.locale,
        template: d.template,
        ticketNumber: d.ticketNumber,
        replyToTicket: d.replyToTicket,
      });
    } catch (err) {
      // An exhausted daily quota or a rejected API key will fail identically on
      // every retry, so retrying only multiplies the failure count (and the
      // 5xx count on /api/inngest). Surface it once instead.
      if (isPermanentSendFailure(err)) {
        throw new NonRetriableError(
          err instanceof Error ? err.message : "Email rejected by provider",
          { cause: err },
        );
      }
      throw err;
    }
    return { ok: true };
  },
);
