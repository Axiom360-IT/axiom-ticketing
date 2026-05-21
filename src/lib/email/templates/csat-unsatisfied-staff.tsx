import { Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

export type CsatUnsatisfiedStaffProps = {
  ticketNumber: string;
  subject: string;
  customerName: string;
  ticketUrl: string;
  locale: string;
};

export async function CsatUnsatisfiedStaffEmail({
  ticketNumber,
  subject,
  customerName,
  ticketUrl,
  locale,
}: CsatUnsatisfiedStaffProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.csatUnsatisfiedStaff",
  });
  return (
    <EmailLayout
      preview={t("preview", { ticketNumber })}
      title={t("title")}
      ticketNumber={ticketNumber}
      locale={locale}
    >
      <Text style={textStyles.body}>{t("body", { ticketNumber, subject })}</Text>
      <Text style={textStyles.meta}>{t("metaCustomer", { customerName })}</Text>
      <Text style={textStyles.body}>{t("guidance")}</Text>
      <Link href={ticketUrl} style={textStyles.button}>
        {t("view")}
      </Link>
    </EmailLayout>
  );
}

CsatUnsatisfiedStaffEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  subject: "Outlook is stuck on the splash screen",
  customerName: "Alex Dean",
  ticketUrl:
    "https://tickets.axiom360.it/admin/tickets/00000000-0000-0000-0000-000000000000",
  locale: "en",
} satisfies CsatUnsatisfiedStaffProps;

export default CsatUnsatisfiedStaffEmail;
