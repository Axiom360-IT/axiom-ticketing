import { Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

export type CustomerMagicLinkProps = {
  url: string;
  locale: string;
};

export async function CustomerMagicLinkEmail({
  url,
  locale,
}: CustomerMagicLinkProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.customerMagicLink",
  });
  return (
    <EmailLayout preview={t("preview")} title={t("title")} locale={locale}>
      <Text style={textStyles.body}>{t("body")}</Text>
      <Link href={url} style={textStyles.button}>
        {t("button")}
      </Link>
      <Text style={textStyles.meta}>{t("expiry")}</Text>
      <Text style={textStyles.meta}>{t("ifNotYou")}</Text>
    </EmailLayout>
  );
}

CustomerMagicLinkEmail.PreviewProps = {
  url: "https://example.com/portal/sign-in/verify?token=abc",
  locale: "en",
} satisfies CustomerMagicLinkProps;

export default CustomerMagicLinkEmail;
