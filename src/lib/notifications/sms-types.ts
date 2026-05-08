// Type-only re-export so the Inngest event-shapes file doesn't pull in
// the Twilio SDK (which lives in lib/sms/send.tsx). Keeping types in a
// separate file lets the dispatch event payload reference SmsTemplate
// without the Inngest serve route having to import twilio.

export type SmsTemplateData = {
  ticketNumber: string;
  ticketUrl: string;
};

export type SmsTemplate =
  | { template: "ticket_assigned"; data: SmsTemplateData }
  | { template: "customer_replied"; data: SmsTemplateData }
  | { template: "sla_warning_80"; data: SmsTemplateData }
  | { template: "sla_breached"; data: SmsTemplateData };
