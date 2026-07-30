import { Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

// Sent when an admin bulk-imports a customer OR resends their invite. Unlike
// staff-setup-invite, the expiry window here is admin-configurable
// (customer_invite.expiry_hours) — expiryHours is passed through so the copy
// always states the ACTUAL window, not a hard-coded guess.

export type CustomerSetupInviteProps = {
  recipientName: string;
  organizationName: string | null;
  setupUrl: string;
  expiryHours: number;
  flow: "set" | "reset";
  locale: string;
};

export async function CustomerSetupInviteEmail({
  recipientName,
  organizationName,
  setupUrl,
  expiryHours,
  flow,
  locale,
}: CustomerSetupInviteProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.customerSetupInvite",
  });
  return (
    <EmailLayout
      preview={flow === "set" ? t("previewSet") : t("previewReset")}
      title={flow === "set" ? t("titleSet") : t("titleReset")}
      locale={locale}
    >
      <Text style={textStyles.body}>
        {flow === "set"
          ? organizationName
            ? t("bodySetWithOrg", { name: recipientName, organizationName })
            : t("bodySet", { name: recipientName })
          : t("bodyReset", { name: recipientName })}
      </Text>
      <Link href={setupUrl} style={textStyles.button}>
        {flow === "set" ? t("buttonSet") : t("buttonReset")}
      </Link>
      <Text style={textStyles.meta}>{t("expiry", { expiryHours })}</Text>
      <Text style={textStyles.meta}>{t("ifNotYou")}</Text>
    </EmailLayout>
  );
}

CustomerSetupInviteEmail.PreviewProps = {
  recipientName: "Jamie Client",
  organizationName: "Kingsmill Foods Company",
  setupUrl: "https://example.com/portal/setup?token=demo",
  expiryHours: 72,
  flow: "set",
  locale: "en",
} satisfies CustomerSetupInviteProps;

export default CustomerSetupInviteEmail;
