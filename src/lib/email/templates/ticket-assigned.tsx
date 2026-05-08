import { Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

export type TicketAssignedProps = {
  ticketNumber: string;
  customerName: string;
  subject: string;
  technicianName: string;
  trackingUrl: string;
  locale: string;
};

export async function TicketAssignedEmail({
  ticketNumber,
  customerName,
  subject,
  technicianName,
  trackingUrl,
  locale,
}: TicketAssignedProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.ticketAssigned",
  });
  return (
    <EmailLayout
      preview={t("preview", { ticketNumber })}
      title={t("title")}
      ticketNumber={ticketNumber}
      locale={locale}
    >
      <Text style={textStyles.body}>{t("greeting", { customerName })}</Text>
      <Text style={textStyles.body}>
        {t("body", { technicianName, ticketNumber, subject })}
      </Text>
      <Text style={textStyles.body}>{t("footer")}</Text>
      <Link href={trackingUrl} style={textStyles.button}>
        {t("view")}
      </Link>
    </EmailLayout>
  );
}

TicketAssignedEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  customerName: "Alex",
  subject: "Outlook is stuck on the splash screen",
  technicianName: "Priya",
  trackingUrl: "https://tickets.axiom360.it/portal/tickets/AX-0042?token=abc",
  locale: "en",
} satisfies TicketAssignedProps;

export default TicketAssignedEmail;
