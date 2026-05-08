import { render } from "@react-email/render";
import { getTranslations } from "next-intl/server";
import { resend } from "./client";
import { getSetting } from "../settings";
import { DEFAULT_LOCALE, pickLocale, type AppLocale } from "../i18n";
import {
  EscalationAlertEmail,
  type EscalationAlertProps,
} from "./templates/escalation-alert";
import {
  InboundBounceEmail,
  type InboundBounceProps,
} from "./templates/inbound-bounce";
import {
  InboundClosedTicketEmail,
  type InboundClosedTicketProps,
} from "./templates/inbound-closed-ticket";
import {
  NewAssignmentEmail,
  type NewAssignmentProps,
} from "./templates/new-assignment";
import {
  TicketAssignedEmail,
  type TicketAssignedProps,
} from "./templates/ticket-assigned";
import {
  TicketClosedEmail,
  type TicketClosedProps,
} from "./templates/ticket-closed";
import {
  TicketCreatedEmail,
  type TicketCreatedProps,
} from "./templates/ticket-created";
import {
  TicketReopenedEmail,
  type TicketReopenedProps,
} from "./templates/ticket-reopened";
import {
  TicketReplyEmail,
  type TicketReplyProps,
} from "./templates/ticket-reply";
import {
  TicketResolvedEmail,
  type TicketResolvedProps,
} from "./templates/ticket-resolved";

// Discriminated union of all template names + their typed props. Locale is
// injected by `sendEmail` from the recipient's preference (or default), so
// callers don't need to plumb it through.
export type EmailTemplate =
  | { template: "ticket_created"; data: Omit<TicketCreatedProps, "locale"> }
  | { template: "ticket_assigned"; data: Omit<TicketAssignedProps, "locale"> }
  | { template: "ticket_reply"; data: Omit<TicketReplyProps, "locale"> }
  | { template: "ticket_resolved"; data: Omit<TicketResolvedProps, "locale"> }
  | { template: "ticket_closed"; data: Omit<TicketClosedProps, "locale"> }
  | { template: "ticket_reopened"; data: Omit<TicketReopenedProps, "locale"> }
  | { template: "new_assignment"; data: Omit<NewAssignmentProps, "locale"> }
  | {
      template: "escalation_alert";
      data: Omit<EscalationAlertProps, "locale">;
    }
  | { template: "inbound_bounce"; data: Omit<InboundBounceProps, "locale"> }
  | {
      template: "inbound_closed_ticket";
      data: Omit<InboundClosedTicketProps, "locale">;
    };

type SendEmailOptions = {
  to: string;
  template: EmailTemplate;
  ticketNumber?: string;
  replyToTicket?: boolean;
  /** Override the default subject (which is derived from the template). */
  subject?: string;
  /**
   * Recipient's preferred locale. Falls back to the app default when omitted
   * (per ARCHITECTURE §18 — guests get the default; signed-in users will
   * eventually pass their `users.language`).
   */
  locale?: string;
};

async function renderTemplate(
  t: EmailTemplate,
  locale: AppLocale,
): Promise<string> {
  switch (t.template) {
    case "ticket_created":
      return await render(<TicketCreatedEmail {...t.data} locale={locale} />);
    case "ticket_assigned":
      return await render(<TicketAssignedEmail {...t.data} locale={locale} />);
    case "ticket_reply":
      return await render(<TicketReplyEmail {...t.data} locale={locale} />);
    case "ticket_resolved":
      return await render(<TicketResolvedEmail {...t.data} locale={locale} />);
    case "ticket_closed":
      return await render(<TicketClosedEmail {...t.data} locale={locale} />);
    case "ticket_reopened":
      return await render(<TicketReopenedEmail {...t.data} locale={locale} />);
    case "new_assignment":
      return await render(<NewAssignmentEmail {...t.data} locale={locale} />);
    case "escalation_alert":
      return await render(
        <EscalationAlertEmail {...t.data} locale={locale} />,
      );
    case "inbound_bounce":
      return await render(<InboundBounceEmail {...t.data} locale={locale} />);
    case "inbound_closed_ticket":
      return await render(
        <InboundClosedTicketEmail {...t.data} locale={locale} />,
      );
  }
}

const TEMPLATE_NAMESPACE = {
  ticket_created: "emails.ticketCreated",
  ticket_assigned: "emails.ticketAssigned",
  ticket_reply: "emails.ticketReply",
  ticket_resolved: "emails.ticketResolved",
  ticket_closed: "emails.ticketClosed",
  ticket_reopened: "emails.ticketReopened",
  new_assignment: "emails.newAssignment",
  escalation_alert: "emails.escalationAlert",
  inbound_bounce: "emails.inboundBounce",
  inbound_closed_ticket: "emails.inboundClosedTicket",
} as const;

async function defaultSubject(
  t: EmailTemplate,
  locale: AppLocale,
): Promise<string> {
  const namespace = TEMPLATE_NAMESPACE[t.template];
  const tr = await getTranslations({ locale, namespace });
  // Subject keys interpolate any of `ticketNumber` and `subject` if they
  // exist on the data; templates that don't carry both still render fine
  // because next-intl ignores absent placeholders.
  const data = t.data as { ticketNumber?: string; subject?: string };
  return tr("subject", {
    ticketNumber: data.ticketNumber ?? "",
    subject: data.subject ?? "",
  });
}

/**
 * Send a transactional email via Resend.
 *
 * Currently called inline from Server Actions. M11 moves all sends through
 * Inngest functions for retry resilience (per ARCHITECTURE §9.5).
 */
export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const { to, template, ticketNumber, replyToTicket, subject, locale } =
    options;

  const resolvedLocale = pickLocale(locale) ?? DEFAULT_LOCALE;
  const html = await renderTemplate(template, resolvedLocale);
  const finalSubject =
    subject ?? (await defaultSubject(template, resolvedLocale));

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
