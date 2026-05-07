import { render } from "@react-email/render";
import { resend } from "./client";
import { getSetting } from "../settings";
import {
  EscalationAlertEmail,
  type EscalationAlertProps,
} from "./templates/escalation-alert";
import {
  NewAssignmentEmail,
  type NewAssignmentProps,
} from "./templates/new-assignment";
import {
  TicketAssignedEmail,
  type TicketAssignedProps,
} from "./templates/ticket-assigned";
import {
  TicketCreatedEmail,
  type TicketCreatedProps,
} from "./templates/ticket-created";
import {
  TicketReplyEmail,
  type TicketReplyProps,
} from "./templates/ticket-reply";

// Discriminated union of all template names + their typed props. Adding a new
// template means adding a case here AND a render branch in `renderTemplate()`.
export type EmailTemplate =
  | { template: "ticket_created"; data: TicketCreatedProps }
  | { template: "ticket_assigned"; data: TicketAssignedProps }
  | { template: "ticket_reply"; data: TicketReplyProps }
  | { template: "new_assignment"; data: NewAssignmentProps }
  | { template: "escalation_alert"; data: EscalationAlertProps };

type SendEmailOptions = {
  to: string;
  template: EmailTemplate;
  ticketNumber?: string;
  replyToTicket?: boolean;
  subject?: string;
};

async function renderTemplate(t: EmailTemplate): Promise<string> {
  switch (t.template) {
    case "ticket_created":
      return await render(<TicketCreatedEmail {...t.data} />);
    case "ticket_assigned":
      return await render(<TicketAssignedEmail {...t.data} />);
    case "ticket_reply":
      return await render(<TicketReplyEmail {...t.data} />);
    case "new_assignment":
      return await render(<NewAssignmentEmail {...t.data} />);
    case "escalation_alert":
      return await render(<EscalationAlertEmail {...t.data} />);
  }
}

function defaultSubject(t: EmailTemplate, ticketNumber?: string): string {
  const num = ticketNumber ? `[${ticketNumber}] ` : "";
  switch (t.template) {
    case "ticket_created":
      return `${num}We've received your ticket: ${t.data.subject}`;
    case "ticket_assigned":
      return `${num}Your ticket has been assigned: ${t.data.subject}`;
    case "ticket_reply":
      return `${num}Re: ${t.data.subject}`;
    case "new_assignment":
      return `${num}New ticket assigned to you: ${t.data.subject}`;
    case "escalation_alert":
      return `${num}Ticket escalated: ${t.data.subject}`;
  }
}

/**
 * Send a transactional email via Resend.
 *
 * Currently called inline from Server Actions. M11 moves all sends through
 * Inngest functions for retry resilience (per ARCHITECTURE §9.5).
 */
export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const { to, template, ticketNumber, replyToTicket, subject } = options;

  const html = await renderTemplate(template);
  const finalSubject = subject ?? defaultSubject(template, ticketNumber);

  const fromName =
    (await getSetting<string>("default_sender_name")) ?? "Axiom360 Support";
  const fromEmail =
    (await getSetting<string>("default_sender_email")) ??
    "support@axiom360.it";
  const inboundDomain =
    (await getSetting<string>("inbound_email_domain")) ?? "axiom360.it";

  const replyTo =
    replyToTicket && ticketNumber
      ? `ticket+${ticketNumber}@${inboundDomain}`
      : undefined;

  await resend.emails.send({
    from: `${fromName} <${fromEmail}>`,
    to,
    subject: finalSubject,
    html,
    replyTo,
    headers: ticketNumber ? { "X-Ticket-Number": ticketNumber } : undefined,
  });
}
