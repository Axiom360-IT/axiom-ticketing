import { render } from "@react-email/render";
import { resend } from "./client";
import { getSetting } from "../settings";
import {
  TicketCreatedEmail,
  type TicketCreatedProps,
} from "./templates/ticket-created";

// Discriminated union of all template names + their typed props. Adding a new
// template means adding a case here AND a render branch in `renderTemplate()`.
// More templates land in Phase C (ticket_assigned, ticket_reply, etc.).
export type EmailTemplate =
  | { template: "ticket_created"; data: TicketCreatedProps };

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
  }
}

function defaultSubject(t: EmailTemplate, ticketNumber?: string): string {
  const num = ticketNumber ? `[${ticketNumber}] ` : "";
  switch (t.template) {
    case "ticket_created":
      return `${num}We've received your ticket: ${t.data.subject}`;
  }
}

/**
 * Send a transactional email via Resend.
 *
 * Currently called inline from Server Actions. Phase B will move all sends
 * through Inngest functions for retry resilience (per ARCHITECTURE §9.5).
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
