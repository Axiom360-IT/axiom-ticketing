import { Hr, Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

// Staff-facing "a new ticket arrived" alert. Distinct from the customer-facing
// `ticket_created` template (which greets "Hi {customerName}" and points at the
// portal): this one is written for the coordinator/director who needs to triage
// and assign it, and links into the admin ticket view.
export type TicketCreatedStaffProps = {
  ticketNumber: string;
  customerName: string;
  subject: string;
  adminUrl: string;
  locale: string;
};

export async function TicketCreatedStaffEmail({
  ticketNumber,
  customerName,
  subject,
  adminUrl,
  locale,
}: TicketCreatedStaffProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.ticketCreatedStaff",
  });
  return (
    <EmailLayout
      preview={t("preview", { ticketNumber, customerName })}
      title={t("title")}
      ticketNumber={ticketNumber}
      locale={locale}
    >
      <Text style={textStyles.body}>
        {t("body", { customerName, ticketNumber })}
      </Text>
      <Text style={textStyles.meta}>{t("metaSubject", { subject })}</Text>
      <Link href={adminUrl} style={textStyles.button}>
        {t("view")}
      </Link>
      <Hr
        style={{
          border: "none",
          borderTop: "1px solid #e4e7eb",
          margin: "20px 0 10px",
        }}
      />
      <Text style={textStyles.meta}>{t("trailerLine")}</Text>
    </EmailLayout>
  );
}

TicketCreatedStaffEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  customerName: "Alex Dean",
  subject: "Outlook is stuck on the splash screen",
  adminUrl:
    "https://tickets.axiom360.it/admin/tickets/00000000-0000-0000-0000-000000000000",
  locale: "en",
} satisfies TicketCreatedStaffProps;

export default TicketCreatedStaffEmail;
