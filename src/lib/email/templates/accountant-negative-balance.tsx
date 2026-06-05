import { Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

// Accountant alert when an organization's Monthly-Plan balance goes negative
// (req 8.6). Sent to the configured accountant contacts (+ optionally the
// Superadmin). Not ticket-scoped.
export type AccountantNegativeBalanceProps = {
  orgName: string;
  overHours: string;
  includedHours: string;
  period: string;
  orgUrl: string;
  locale: string;
};

export async function AccountantNegativeBalanceEmail({
  orgName,
  overHours,
  includedHours,
  period,
  orgUrl,
  locale,
}: AccountantNegativeBalanceProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.accountantNegativeBalance",
  });
  return (
    <EmailLayout preview={t("preview", { orgName })} title={t("title")} locale={locale}>
      <Text style={textStyles.body}>{t("body", { orgName, overHours })}</Text>
      <Text style={textStyles.meta}>{t("metaPlan", { includedHours, period })}</Text>
      <Text style={textStyles.body}>{t("guidance")}</Text>
      <Link href={orgUrl} style={textStyles.button}>
        {t("view")}
      </Link>
    </EmailLayout>
  );
}

AccountantNegativeBalanceEmail.PreviewProps = {
  orgName: "Kingsmill Foods",
  overHours: "3.5h",
  includedHours: "20h",
  period: "June 2026",
  orgUrl: "https://tickets.axiom360.it/admin/organizations/00000000-0000-0000-0000-000000000000",
  locale: "en",
} satisfies AccountantNegativeBalanceProps;

export default AccountantNegativeBalanceEmail;
