import { render } from "@react-email/render";
import { getTranslations } from "next-intl/server";
import { resend } from "./client";
import { getSetting } from "../settings";
import { DEFAULT_LOCALE, pickLocale, type AppLocale } from "../i18n";
import {
  AccountLockoutEmail,
  type AccountLockoutProps,
} from "./templates/account-lockout";
import {
  AttachmentQuarantinedEmail,
  type AttachmentQuarantinedProps,
} from "./templates/attachment-quarantined";
import {
  CustomerMagicLinkEmail,
  type CustomerMagicLinkProps,
} from "./templates/customer-magic-link";
import {
  CustomerWelcomeEmail,
  type CustomerWelcomeProps,
} from "./templates/customer-welcome";
import {
  StaffSetupInviteEmail,
  type StaffSetupInviteProps,
} from "./templates/staff-setup-invite";
import {
  CsatUnsatisfiedStaffEmail,
  type CsatUnsatisfiedStaffProps,
} from "./templates/csat-unsatisfied-staff";
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
  ProcurementApprovedEmail,
  type ProcurementApprovedProps,
} from "./templates/procurement-approved";
import {
  ProcurementDeliveredEmail,
  type ProcurementDeliveredProps,
} from "./templates/procurement-delivered";
import {
  ProcurementRejectedEmail,
  type ProcurementRejectedProps,
} from "./templates/procurement-rejected";
import {
  ProcurementSubmittedEmail,
  type ProcurementSubmittedProps,
} from "./templates/procurement-submitted";
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
  | {
      template: "csat_unsatisfied_staff";
      data: Omit<CsatUnsatisfiedStaffProps, "locale">;
    }
  | { template: "inbound_bounce"; data: Omit<InboundBounceProps, "locale"> }
  | {
      template: "inbound_closed_ticket";
      data: Omit<InboundClosedTicketProps, "locale">;
    }
  | {
      template: "procurement_submitted";
      data: Omit<ProcurementSubmittedProps, "locale">;
    }
  | {
      template: "procurement_approved";
      data: Omit<ProcurementApprovedProps, "locale">;
    }
  | {
      template: "procurement_rejected";
      data: Omit<ProcurementRejectedProps, "locale">;
    }
  | {
      template: "procurement_delivered";
      data: Omit<ProcurementDeliveredProps, "locale">;
    }
  | {
      template: "account_lockout";
      data: Omit<AccountLockoutProps, "locale">;
    }
  | {
      template: "attachment_quarantined";
      data: Omit<AttachmentQuarantinedProps, "locale">;
    }
  | {
      template: "customer_magic_link";
      data: Omit<CustomerMagicLinkProps, "locale">;
    }
  | {
      template: "customer_welcome";
      data: Omit<CustomerWelcomeProps, "locale">;
    }
  | {
      template: "staff_setup_invite";
      data: Omit<StaffSetupInviteProps, "locale">;
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
  /**
   * Prepend an actor's name to the configured From: display name. Used for
   * agent-to-customer messages so the customer's inbox shows
   * `"Maria — Axiom360 Support" <team@…>` instead of just the brand. The
   * underlying email address never changes (always the configured sender),
   * only the display label.
   */
  fromActorName?: string;
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
    case "csat_unsatisfied_staff":
      return await render(
        <CsatUnsatisfiedStaffEmail {...t.data} locale={locale} />,
      );
    case "inbound_bounce":
      return await render(<InboundBounceEmail {...t.data} locale={locale} />);
    case "inbound_closed_ticket":
      return await render(
        <InboundClosedTicketEmail {...t.data} locale={locale} />,
      );
    case "procurement_submitted":
      return await render(
        <ProcurementSubmittedEmail {...t.data} locale={locale} />,
      );
    case "procurement_approved":
      return await render(
        <ProcurementApprovedEmail {...t.data} locale={locale} />,
      );
    case "procurement_rejected":
      return await render(
        <ProcurementRejectedEmail {...t.data} locale={locale} />,
      );
    case "procurement_delivered":
      return await render(
        <ProcurementDeliveredEmail {...t.data} locale={locale} />,
      );
    case "account_lockout":
      return await render(
        <AccountLockoutEmail {...t.data} locale={locale} />,
      );
    case "attachment_quarantined":
      return await render(
        <AttachmentQuarantinedEmail {...t.data} locale={locale} />,
      );
    case "customer_magic_link":
      return await render(
        <CustomerMagicLinkEmail {...t.data} locale={locale} />,
      );
    case "customer_welcome":
      return await render(
        <CustomerWelcomeEmail {...t.data} locale={locale} />,
      );
    case "staff_setup_invite":
      return await render(
        <StaffSetupInviteEmail {...t.data} locale={locale} />,
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
  csat_unsatisfied_staff: "emails.csatUnsatisfiedStaff",
  inbound_bounce: "emails.inboundBounce",
  inbound_closed_ticket: "emails.inboundClosedTicket",
  procurement_submitted: "emails.procurementSubmitted",
  procurement_approved: "emails.procurementApproved",
  procurement_rejected: "emails.procurementRejected",
  procurement_delivered: "emails.procurementDelivered",
  account_lockout: "emails.accountLockout",
  attachment_quarantined: "emails.attachmentQuarantined",
  customer_magic_link: "emails.customerMagicLink",
  customer_welcome: "emails.customerWelcome",
  staff_setup_invite: "emails.staffSetupInvite",
} as const;

async function defaultSubject(
  t: EmailTemplate,
  locale: AppLocale,
): Promise<string> {
  const namespace = TEMPLATE_NAMESPACE[t.template];
  const tr = await getTranslations({ locale, namespace });
  // Pass every primitive field on the template data as a placeholder
  // value — next-intl ignores keys that aren't referenced by the message,
  // so each template can pick whichever fields it needs (ticketNumber,
  // subject, itemName, etc.).
  const values: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(t.data as Record<string, unknown>)) {
    if (typeof v === "string" || typeof v === "number") values[k] = v;
  }
  return tr("subject", values);
}

/**
 * Send a transactional email via Resend.
 *
 * Currently called inline from Server Actions. M11 moves all sends through
 * Inngest functions for retry resilience (per ARCHITECTURE §9.5).
 */
export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const {
    to,
    template,
    ticketNumber,
    replyToTicket,
    subject,
    locale,
    fromActorName,
  } = options;

  const resolvedLocale = pickLocale(locale) ?? DEFAULT_LOCALE;
  const html = await renderTemplate(template, resolvedLocale);
  const finalSubject =
    subject ?? (await defaultSubject(template, resolvedLocale));

  // Env vars take precedence over DB settings so dev can point sends at
  // Resend's sandbox (`onboarding@resend.dev`) before the production domain
  // is verified in M19, without polluting the seeded settings table.
  const baseFromName =
    process.env.RESEND_FROM_NAME ??
    (await getSetting<string>("default_sender_name")) ??
    "Axiom360 Support";
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ??
    (await getSetting<string>("default_sender_email")) ??
    "support@axiom360.it";
  const inboundDomain =
    (await getSetting<string>("inbound_email_domain")) ?? "axiom360.it";

  // When an agent is the author of the message (e.g. replying to a
  // ticket), surface their name in the display label so the customer's
  // inbox shows "Maria — Axiom360 Support" instead of just "Axiom360
  // Support". The underlying sender address is unchanged. Strip any
  // characters that would break the address quoting (newlines, `<>"`).
  const sanitizedActor = fromActorName
    ?.replace(/[\r\n<>"]/g, " ")
    .trim()
    .slice(0, 60);
  const displayName =
    sanitizedActor && sanitizedActor.length > 0
      ? `${sanitizedActor} — ${baseFromName}`
      : baseFromName;

  const replyTo =
    replyToTicket && ticketNumber
      ? `ticket+${ticketNumber}@${inboundDomain}`
      : undefined;

  await resend.emails.send({
    from: `${displayName} <${fromEmail}>`,
    to,
    subject: finalSubject,
    html,
    replyTo,
    headers: ticketNumber ? { "X-Ticket-Number": ticketNumber } : undefined,
  });
}
