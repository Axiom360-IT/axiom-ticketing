// Type-only re-export so the Inngest event-shapes file doesn't pull in
// the Twilio SDK (which lives in lib/sms/send.tsx). Keeping types in a
// separate file lets the dispatch event payload reference SmsTemplate
// without the Inngest serve route having to import twilio.

export type SmsTemplateData = {
  ticketNumber: string;
  ticketUrl: string;
};

// Accountant over-plan alert (req 8.6) — not ticket-scoped.
export type AccountantBalanceSmsData = {
  orgName: string;
  overHours: string;
};

export type SmsTemplate =
  // Accountant-facing (configured contacts, not app users)
  | {
      template: "accountant_negative_balance";
      data: AccountantBalanceSmsData;
    }
  // Staff-facing
  | { template: "ticket_assigned"; data: SmsTemplateData }
  | { template: "ticket_reassigned"; data: SmsTemplateData }
  | { template: "ticket_escalated"; data: SmsTemplateData }
  | { template: "customer_replied"; data: SmsTemplateData }
  | { template: "csat_unsatisfied_staff"; data: SmsTemplateData }
  | { template: "sla_warning_80"; data: SmsTemplateData }
  | { template: "sla_breached"; data: SmsTemplateData }
  // Customer-facing — different wording from the staff variants because
  // the link target is the customer portal and the message describes
  // events from the customer's POV.
  | { template: "ticket_assigned_customer"; data: SmsTemplateData }
  | { template: "agent_replied"; data: SmsTemplateData }
  | { template: "ticket_resolved"; data: SmsTemplateData }
  | { template: "ticket_reopened"; data: SmsTemplateData }
  | { template: "ticket_closed"; data: SmsTemplateData };
