import { Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

export type TicketReassignedProps = {
  ticketNumber: string;
  subject: string;
  fromTechName: string;
  toTechName: string;
  actorName: string;
  customerName: string;
  ticketUrl: string;
  locale: string;
};

export async function TicketReassignedEmail({
  ticketNumber,
  subject,
  fromTechName,
  toTechName,
  actorName,
  customerName,
  ticketUrl,
  locale,
}: TicketReassignedProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.ticketReassigned",
  });
  return (
    <EmailLayout
      preview={t("preview", { ticketNumber })}
      title={t("title")}
      ticketNumber={ticketNumber}
      locale={locale}
    >
      <Text style={textStyles.body}>{t("intro")}</Text>
      <Text style={textStyles.body}>
        {t("body", {
          actorName,
          ticketNumber,
          subject,
          fromTechName,
          toTechName,
        })}
      </Text>
      <Text style={textStyles.meta}>{t("metaCustomer", { customerName })}</Text>
      <Link href={ticketUrl} style={textStyles.button}>
        {t("view")}
      </Link>
    </EmailLayout>
  );
}

TicketReassignedEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  subject: "Outlook is stuck on the splash screen",
  fromTechName: "Priya",
  toTechName: "Marcus",
  actorName: "Priya",
  customerName: "Alex Dean",
  ticketUrl:
    "https://tickets.axiom360.it/admin/tickets/00000000-0000-0000-0000-000000000000",
  locale: "en",
} satisfies TicketReassignedProps;

export default TicketReassignedEmail;
