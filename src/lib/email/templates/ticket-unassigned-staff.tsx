import { Hr, Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

// Staff-facing "this ticket is still unassigned" nudge. Sent by the
// unassigned-ticket monitor to Coordinators / IT Directors / Super Admins
// when a ticket has sat past the configured threshold with no technician.
export type TicketUnassignedStaffProps = {
  ticketNumber: string;
  subject: string;
  adminUrl: string;
  locale: string;
};

export async function TicketUnassignedStaffEmail({
  ticketNumber,
  subject,
  adminUrl,
  locale,
}: TicketUnassignedStaffProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.ticketUnassignedStaff",
  });
  return (
    <EmailLayout
      preview={t("preview", { ticketNumber })}
      title={t("title")}
      ticketNumber={ticketNumber}
      locale={locale}
    >
      <Text style={textStyles.body}>{t("body", { ticketNumber })}</Text>
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

TicketUnassignedStaffEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  subject: "Outlook is stuck on the splash screen",
  adminUrl:
    "https://tickets.axiom360.it/admin/tickets/00000000-0000-0000-0000-000000000000",
  locale: "en",
} satisfies TicketUnassignedStaffProps;

export default TicketUnassignedStaffEmail;
