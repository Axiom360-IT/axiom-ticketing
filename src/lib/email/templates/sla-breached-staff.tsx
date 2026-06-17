import { Hr, Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

// Staff-facing "an SLA was breached" alert. Broadcast to the oversight roles
// (Super Admin, IT Director, Coordinator) plus the assignee so a missed
// deadline reaches management, not just the bell. `kind` is the breached
// target — "response" or "resolution".
export type SlaBreachedStaffProps = {
  ticketNumber: string;
  kind: string;
  adminUrl: string;
  locale: string;
};

export async function SlaBreachedStaffEmail({
  ticketNumber,
  kind,
  adminUrl,
  locale,
}: SlaBreachedStaffProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.slaBreachedStaff",
  });
  return (
    <EmailLayout
      preview={t("preview", { ticketNumber })}
      title={t("title")}
      ticketNumber={ticketNumber}
      locale={locale}
    >
      <Text style={textStyles.body}>{t("body", { ticketNumber, kind })}</Text>
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

SlaBreachedStaffEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  kind: "response",
  adminUrl:
    "https://tickets.axiom360.it/admin/tickets/00000000-0000-0000-0000-000000000000",
  locale: "en",
} satisfies SlaBreachedStaffProps;

export default SlaBreachedStaffEmail;
