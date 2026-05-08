import { Link, Section, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

export type ProcurementRejectedProps = {
  ticketNumber: string;
  itemName: string;
  reason: string;
  adminUrl: string;
  locale: string;
};

export async function ProcurementRejectedEmail({
  ticketNumber,
  itemName,
  reason,
  adminUrl,
  locale,
}: ProcurementRejectedProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.procurementRejected",
  });
  return (
    <EmailLayout
      preview={t("preview", { itemName })}
      title={t("title")}
      ticketNumber={ticketNumber}
      locale={locale}
    >
      <Text style={textStyles.body}>{t("greeting")}</Text>
      <Text style={textStyles.body}>{t("body", { itemName })}</Text>
      <Section
        style={{
          backgroundColor: "#fef2f2",
          border: "1px solid #fecaca",
          borderRadius: "6px",
          padding: "12px 16px",
          margin: "12px 0",
        }}
      >
        <Text style={{ ...textStyles.body, margin: 0 }}>{reason}</Text>
      </Section>
      <Text style={textStyles.body}>{t("nextSteps")}</Text>
      <Link href={adminUrl} style={textStyles.button}>
        {t("review")}
      </Link>
    </EmailLayout>
  );
}

ProcurementRejectedEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  itemName: "Dell Latitude 5450",
  reason: "We have stock of an equivalent unit; please reuse #LX-1234.",
  adminUrl: "https://tickets.axiom360.it/admin/procurement/00000000",
  locale: "en",
} satisfies ProcurementRejectedProps;

export default ProcurementRejectedEmail;
