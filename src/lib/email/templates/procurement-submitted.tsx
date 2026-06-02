import { Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

export type ProcurementSubmittedProps = {
  ticketNumber: string;
  ticketSubject: string;
  requesterName: string;
  itemName: string;
  quantity: number;
  adminUrl: string;
  locale: string;
};

export async function ProcurementSubmittedEmail({
  ticketNumber,
  ticketSubject,
  requesterName,
  itemName,
  quantity,
  adminUrl,
  locale,
}: ProcurementSubmittedProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.procurementSubmitted",
  });
  return (
    <EmailLayout
      preview={t("preview", { itemName })}
      title={t("title")}
      ticketNumber={ticketNumber}
      locale={locale}
    >
      <Text style={textStyles.body}>{t("greeting")}</Text>
      <Text style={textStyles.body}>
        {t("body", { requesterName, itemName, quantity })}
      </Text>
      <Text style={textStyles.meta}>
        {t("meta", { ticketNumber, ticketSubject })}
      </Text>
      <Link href={adminUrl} style={textStyles.button}>
        {t("review")}
      </Link>
    </EmailLayout>
  );
}

ProcurementSubmittedEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  ticketSubject: "New laptop for onboarding",
  requesterName: "Priya",
  itemName: "Dell Latitude 5450",
  quantity: 1,
  adminUrl: "https://tickets.axiom360.it/admin/procurement/00000000",
  locale: "en",
} satisfies ProcurementSubmittedProps;

export default ProcurementSubmittedEmail;
