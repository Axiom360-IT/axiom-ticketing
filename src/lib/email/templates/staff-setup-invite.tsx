import { Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

// Sent when an admin creates a new staff user OR triggers a password
// reset on an existing user. Same template covers both because the
// user-facing call to action is identical: "click this to set your
// password and log in." The differentiation is in the subject line
// (set in `defaultSubject` of email/send.tsx).

export type StaffSetupInviteProps = {
  /** Display name of the new staff member. */
  recipientName: string;
  /** URL the user clicks to set their password. */
  setupUrl: string;
  /** "set" for new users, "reset" for existing users — drives copy. */
  flow: "set" | "reset";
  locale: string;
};

export async function StaffSetupInviteEmail({
  recipientName,
  setupUrl,
  flow,
  locale,
}: StaffSetupInviteProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.staffSetupInvite",
  });
  return (
    <EmailLayout
      preview={flow === "set" ? t("previewSet") : t("previewReset")}
      title={flow === "set" ? t("titleSet") : t("titleReset")}
      locale={locale}
    >
      <Text style={textStyles.body}>
        {flow === "set"
          ? t("bodySet", { name: recipientName })
          : t("bodyReset", { name: recipientName })}
      </Text>
      <Link href={setupUrl} style={textStyles.button}>
        {flow === "set" ? t("buttonSet") : t("buttonReset")}
      </Link>
      <Text style={textStyles.meta}>{t("expiry")}</Text>
      <Text style={textStyles.meta}>{t("ifNotYou")}</Text>
    </EmailLayout>
  );
}

StaffSetupInviteEmail.PreviewProps = {
  recipientName: "Alice Technician",
  setupUrl: "https://example.com/admin/setup?token=demo",
  flow: "set",
  locale: "en",
} satisfies StaffSetupInviteProps;
