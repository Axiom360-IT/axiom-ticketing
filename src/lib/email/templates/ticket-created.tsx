import { Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

export type TicketCreatedProps = {
  ticketNumber: string;
  customerName: string;
  subject: string;
  trackingUrl: string;
  locale: string;
};

export async function TicketCreatedEmail({
  ticketNumber,
  customerName,
  subject,
  trackingUrl,
  locale,
}: TicketCreatedProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.ticketCreated",
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
        {t("body", { ticketNumber, subject })}
      </Text>
      <Text style={textStyles.body}>{t("replyHint")}</Text>
      <Link href={trackingUrl} style={textStyles.button}>
        {t("view")}
      </Link>
      <Text style={textStyles.meta}>
        {t("fallback")}
        <br />
        {trackingUrl}
      </Text>
    </EmailLayout>
  );
}

TicketCreatedEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  customerName: "Alex",
  subject: "Outlook is stuck on the splash screen",
  trackingUrl: "https://tickets.axiom360.it/portal/tickets/AX-0042?token=abc",
  locale: "en",
} satisfies TicketCreatedProps;

export default TicketCreatedEmail;
