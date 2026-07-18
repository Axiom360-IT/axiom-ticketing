import { Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

export type CustomerFollowupProps = {
  ticketNumber: string;
  customerName: string;
  subject: string;
  /** Where the customer can view / reply to the ticket. */
  ticketUrl: string;
  /** Human-readable date the ticket will auto-close if still no reply. */
  closeDate: string;
  locale: string;
};

export async function CustomerFollowupEmail({
  ticketNumber,
  customerName,
  subject,
  ticketUrl,
  closeDate,
  locale,
}: CustomerFollowupProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.customerFollowup",
  });
  return (
    <EmailLayout
      preview={t("preview", { ticketNumber })}
      title={t("title")}
      ticketNumber={ticketNumber}
      locale={locale}
    >
      <Text style={textStyles.body}>{t("greeting", { customerName })}</Text>
      <Text style={textStyles.body}>{t("body", { ticketNumber, subject })}</Text>
      <Text style={textStyles.body}>{t("closeNotice", { closeDate })}</Text>
      <Text style={textStyles.body}>{t("prompt")}</Text>
      <Link href={ticketUrl} style={textStyles.button}>
        {t("viewTicket")}
      </Link>
    </EmailLayout>
  );
}

CustomerFollowupEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  customerName: "Alex",
  subject: "Outlook is stuck on the splash screen",
  ticketUrl: "https://tickets.axiom360.it/portal/tickets/AX-0042",
  closeDate: "18 July 2026",
  locale: "en",
} satisfies CustomerFollowupProps;

export default CustomerFollowupEmail;
