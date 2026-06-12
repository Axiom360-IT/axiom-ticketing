import { getTranslations } from "next-intl/server";
import { DEFAULT_LOCALE, pickLocale, type AppLocale } from "../i18n";
import type { SmsTemplate } from "../notifications/sms-types";
import { getAppUrl } from "../request";
import { twilioClient, twilioFromNumber } from "./client";

// Outbound SMS. Templates are i18n keys (per ARCHITECTURE §10) so messages
// are rendered in the recipient's locale. We keep them under 160 chars to
// avoid multi-segment billing.

export type { SmsTemplate } from "../notifications/sms-types";

const TEMPLATE_NAMESPACE = {
  // Accountant-facing (configured contacts, not app users)
  accountant_negative_balance: "sms.accountantNegativeBalance",
  // Staff-facing
  ticket_created: "sms.ticketCreated",
  ticket_assigned: "sms.ticketAssigned",
  ticket_reassigned: "sms.ticketReassigned",
  ticket_escalated: "sms.ticketEscalated",
  customer_replied: "sms.customerReplied",
  csat_unsatisfied_staff: "sms.csatUnsatisfiedStaff",
  sla_warning_80: "sms.slaWarning80",
  sla_breached: "sms.slaBreached",
  // Customer-facing
  ticket_assigned_customer: "sms.ticketAssignedCustomer",
  agent_replied: "sms.agentReplied",
  ticket_resolved: "sms.ticketResolved",
  ticket_reopened: "sms.ticketReopened",
  ticket_closed: "sms.ticketClosed",
} as const;

type SendSmsOptions = {
  to: string;
  template: SmsTemplate;
  /** Recipient's preferred locale; falls back to the app default. */
  locale?: string;
  /** Override the status callback URL — defaults to /api/twilio/status. */
  statusCallbackUrl?: string;
};

async function renderBody(
  t: SmsTemplate,
  locale: AppLocale,
): Promise<string> {
  const namespace = TEMPLATE_NAMESPACE[t.template];
  const tr = await getTranslations({ locale, namespace });
  return tr("body", t.data as Record<string, string>);
}

/**
 * Send an SMS via Twilio. Best-effort by convention — callers wrap this
 * in a try/catch and log; a Twilio outage shouldn't fail the underlying
 * Server Action.
 */
export async function sendSms(options: SendSmsOptions): Promise<{
  sid: string;
} | null> {
  const { to, template, locale, statusCallbackUrl } = options;
  if (!to || to.trim().length === 0) return null;

  const resolvedLocale = pickLocale(locale) ?? DEFAULT_LOCALE;
  const body = await renderBody(template, resolvedLocale);

  // SMS bodies must render even if NEXT_PUBLIC_APP_URL is unset (e.g. in
  // dev/test) — fall back to omitting the callback rather than throwing.
  let appUrl = "";
  try {
    appUrl = getAppUrl();
  } catch {
    appUrl = "";
  }
  const callback =
    statusCallbackUrl ?? (appUrl ? `${appUrl}/api/twilio/status` : undefined);

  const message = await twilioClient().messages.create({
    from: twilioFromNumber(),
    to,
    body,
    ...(callback ? { statusCallback: callback } : {}),
  });
  return { sid: message.sid };
}
