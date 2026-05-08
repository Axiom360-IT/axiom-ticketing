import { Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

export type EscalationAlertProps = {
  ticketNumber: string;
  recipientName: string;
  subject: string;
  technicianName: string;
  reason: string;
  customerName: string;
  ticketUrl: string;
  locale: string;
};

export async function EscalationAlertEmail({
  ticketNumber,
  recipientName,
  subject,
  technicianName,
  reason,
  customerName,
  ticketUrl,
  locale,
}: EscalationAlertProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.escalationAlert",
  });
  return (
    <EmailLayout
      preview={t("preview", { ticketNumber })}
      title={t("title")}
      ticketNumber={ticketNumber}
      locale={locale}
    >
      <Text style={textStyles.body}>{t("greeting", { recipientName })}</Text>
      <Text style={textStyles.body}>
        {t("body", { technicianName, ticketNumber, subject })}
      </Text>
      <Text style={textStyles.meta}>
        {t("metaReason", { reason })}
        <br />
        {t("metaCustomer", { customerName })}
      </Text>
      <Text style={textStyles.body}>{t("guidance", { technicianName })}</Text>
      <Link href={ticketUrl} style={textStyles.button}>
        {t("view")}
      </Link>
    </EmailLayout>
  );
}

EscalationAlertEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  recipientName: "Evelyn",
  subject: "Outlook is stuck on the splash screen",
  technicianName: "Priya",
  reason: "Beyond technician scope — requires vendor escalation.",
  customerName: "Alex Dean",
  ticketUrl: "https://tickets.axiom360.it/admin/tickets/00000000-0000-0000-0000-000000000000",
  locale: "en",
} satisfies EscalationAlertProps;

export default EscalationAlertEmail;
