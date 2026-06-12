import { Hr, Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

// Staff-facing "a ticket was closed" alert (oversight). Distinct from the
// customer-facing `ticket_closed` template, which greets "Hi {customerName}"
// and points at the portal; this one is written for Coordinators / IT
// Directors / Super Admins and links into the admin ticket view.
export type TicketClosedStaffProps = {
  ticketNumber: string;
  subject: string;
  /** "csat" = customer confirmed; "auto" = auto-closed after no response. */
  reason: "csat" | "auto";
  adminUrl: string;
  locale: string;
};

export async function TicketClosedStaffEmail({
  ticketNumber,
  subject,
  reason,
  adminUrl,
  locale,
}: TicketClosedStaffProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.ticketClosedStaff",
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
      <Text style={textStyles.meta}>{t("reason", { reason })}</Text>
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

TicketClosedStaffEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  subject: "Outlook is stuck on the splash screen",
  reason: "csat",
  adminUrl:
    "https://tickets.axiom360.it/admin/tickets/00000000-0000-0000-0000-000000000000",
  locale: "en",
} satisfies TicketClosedStaffProps;

export default TicketClosedStaffEmail;
