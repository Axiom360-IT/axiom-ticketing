import { eventType, NonRetriableError } from "inngest";
import { isPermanentSendFailure } from "@/lib/notifications/permanent-failure";
import { sendSms } from "@/lib/sms/send";
import type { SmsTemplate } from "@/lib/notifications/sms-types";
import { inngest } from "../client";

// Receives a per-recipient notification/sms child event from the
// dispatcher and calls sendSms. Twilio errors are retried up to 3
// times by Inngest with backoff.

type EventData = {
  to: string;
  locale: string;
  template: SmsTemplate;
};

export const sendSmsNotification = inngest.createFunction(
  {
    id: "send-sms-notification",
    retries: 3,
    triggers: eventType("notification/sms"),
  },
  async ({ event }) => {
    const d = event.data as EventData;
    try {
      await sendSms({ to: d.to, locale: d.locale, template: d.template });
    } catch (err) {
      // Twilio 20003 (bad credentials / suspended account) and invalid-number
      // errors cannot resolve between attempts — see permanent-failure.ts.
      if (isPermanentSendFailure(err)) {
        throw new NonRetriableError(
          err instanceof Error ? err.message : "SMS rejected by provider",
          { cause: err },
        );
      }
      throw err;
    }
    return { ok: true };
  },
);
