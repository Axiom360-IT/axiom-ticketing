import { getTranslations } from "next-intl/server";
import { DEFAULT_LOCALE, pickLocale, type AppLocale } from "../i18n";
import { twilioClient, twilioFromNumber } from "./client";

// Outbound SMS. Templates are i18n keys (per ARCHITECTURE §10) so messages
// are rendered in the recipient's locale. We keep them under 160 chars to
// avoid multi-segment billing.
//
// Server Actions call this directly for the assignment + customer-replied
// paths. The SLA monitor + the M11 dispatch fan-out also call it.

export type SmsTemplate =
  | {
      template: "ticket_assigned";
      data: { ticketNumber: string; ticketUrl: string };
    }
  | {
      template: "customer_replied";
      data: { ticketNumber: string; ticketUrl: string };
    }
  | {
      template: "sla_warning_80";
      data: { ticketNumber: string; ticketUrl: string };
    }
  | {
      template: "sla_breached";
      data: { ticketNumber: string; ticketUrl: string };
    };

const TEMPLATE_NAMESPACE = {
  ticket_assigned: "sms.ticketAssigned",
  customer_replied: "sms.customerReplied",
  sla_warning_80: "sms.slaWarning80",
  sla_breached: "sms.slaBreached",
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
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
