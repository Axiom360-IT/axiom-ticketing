import { Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

export type CustomerWelcomeProps = {
  customerName: string;
  portalUrl: string;
  claimedCount: number;
  locale: string;
};

export async function CustomerWelcomeEmail({
  customerName,
  portalUrl,
  claimedCount,
  locale,
}: CustomerWelcomeProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.customerWelcome",
  });
  return (
    <EmailLayout preview={t("preview")} title={t("title")} locale={locale}>
      <Text style={textStyles.body}>{t("greeting", { customerName })}</Text>
      {claimedCount > 0 ? (
        <Text style={textStyles.body}>
          {t("claimedBody", { count: claimedCount })}
        </Text>
      ) : (
        <Text style={textStyles.body}>{t("noClaimedBody")}</Text>
      )}
      <Link href={portalUrl} style={textStyles.button}>
        {t("button")}
      </Link>
    </EmailLayout>
  );
}

CustomerWelcomeEmail.PreviewProps = {
  customerName: "Jamie",
  portalUrl: "https://example.com/portal/tickets",
  claimedCount: 3,
  locale: "en",
} satisfies CustomerWelcomeProps;

export default CustomerWelcomeEmail;
