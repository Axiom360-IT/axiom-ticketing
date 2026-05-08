import { Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

export type TicketReopenedProps = {
  ticketNumber: string;
  customerName: string;
  subject: string;
  // "csat_unsatisfied" — customer pressed "no" on CSAT email.
  // "agent" — a coordinator/agent reopened from the dashboard.
  reason: "csat_unsatisfied" | "agent";
  trackingUrl: string;
  locale: string;
};

export async function TicketReopenedEmail({
  ticketNumber,
  customerName,
  subject,
  reason,
  trackingUrl,
  locale,
}: TicketReopenedProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.ticketReopened",
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
        {reason === "csat_unsatisfied"
          ? t("bodyCsat", { ticketNumber, subject })
          : t("bodyAgent", { ticketNumber, subject })}
      </Text>
      <Text style={textStyles.body}>{t("footer")}</Text>
      <Link href={trackingUrl} style={textStyles.button}>
        {t("view")}
      </Link>
    </EmailLayout>
  );
}

TicketReopenedEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  customerName: "Alex",
  subject: "Outlook is stuck on the splash screen",
  reason: "csat_unsatisfied",
  trackingUrl: "https://tickets.axiom360.it/portal/tickets/AX-0042?token=abc",
  locale: "en",
} satisfies TicketReopenedProps;

export default TicketReopenedEmail;
