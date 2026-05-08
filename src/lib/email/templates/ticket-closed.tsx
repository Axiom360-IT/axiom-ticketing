import { Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

export type TicketClosedProps = {
  ticketNumber: string;
  customerName: string;
  subject: string;
  // "csat" — customer marked satisfied; "auto" — 24h auto-close after no CSAT.
  reason: "csat" | "auto";
  newTicketUrl: string;
  locale: string;
};

export async function TicketClosedEmail({
  ticketNumber,
  customerName,
  subject,
  reason,
  newTicketUrl,
  locale,
}: TicketClosedProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.ticketClosed",
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
        {reason === "csat"
          ? t("bodyCsat", { ticketNumber, subject })
          : t("bodyAuto", { ticketNumber, subject })}
      </Text>
      <Text style={textStyles.body}>{t("newTicketPrompt")}</Text>
      <Link href={newTicketUrl} style={textStyles.button}>
        {t("newTicket")}
      </Link>
    </EmailLayout>
  );
}

TicketClosedEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  customerName: "Alex",
  subject: "Outlook is stuck on the splash screen",
  reason: "csat",
  newTicketUrl: "https://tickets.axiom360.it/portal/submit",
  locale: "en",
} satisfies TicketClosedProps;

export default TicketClosedEmail;
