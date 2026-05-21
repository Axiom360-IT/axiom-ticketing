import { Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

export type CustomerEmailVerificationProps = {
  recipientName: string;
  verifyUrl: string;
  locale: string;
};

export async function CustomerEmailVerificationEmail({
  recipientName,
  verifyUrl,
  locale,
}: CustomerEmailVerificationProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.customerEmailVerification",
  });
  return (
    <EmailLayout preview={t("preview")} title={t("title")} locale={locale}>
      <Text style={textStyles.body}>{t("greeting", { recipientName })}</Text>
      <Text style={textStyles.body}>{t("body")}</Text>
      <Link href={verifyUrl} style={textStyles.button}>
        {t("button")}
      </Link>
      <Text style={textStyles.meta}>{t("ifNotYou")}</Text>
    </EmailLayout>
  );
}

CustomerEmailVerificationEmail.PreviewProps = {
  recipientName: "Alex",
  verifyUrl: "https://example.com/api/auth/verify-email?token=abc",
  locale: "en",
} satisfies CustomerEmailVerificationProps;

export default CustomerEmailVerificationEmail;
