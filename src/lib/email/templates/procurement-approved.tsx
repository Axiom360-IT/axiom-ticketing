import { Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

export type ProcurementApprovedProps = {
  ticketNumber: string;
  itemName: string;
  quantity: number;
  adminUrl: string;
  locale: string;
};

export async function ProcurementApprovedEmail({
  ticketNumber,
  itemName,
  quantity,
  adminUrl,
  locale,
}: ProcurementApprovedProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.procurementApproved",
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
        {t("body", { itemName, quantity })}
      </Text>
      <Link href={adminUrl} style={textStyles.button}>
        {t("review")}
      </Link>
    </EmailLayout>
  );
}

ProcurementApprovedEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  itemName: "Dell Latitude 5450",
  quantity: 1,
  adminUrl: "https://tickets.axiom360.it/admin/procurement/00000000",
  locale: "en",
} satisfies ProcurementApprovedProps;

export default ProcurementApprovedEmail;
