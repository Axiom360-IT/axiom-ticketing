import { eventType } from "inngest";
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
    await sendSms({
      to: d.to,
      locale: d.locale,
      template: d.template,
    });
    return { ok: true };
  },
);
