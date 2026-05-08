import { Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

// Sent when an account is temporarily locked after N failed sign-in
// attempts (M16 Phase B). Tells the user how long the lock holds and
// who to contact for early unlock.
export type AccountLockoutProps = {
  userName: string;
  attempts: number;
  minutes: number;
  locale: string;
};

export async function AccountLockoutEmail({
  userName,
  attempts,
  minutes,
  locale,
}: AccountLockoutProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.accountLockout",
  });
  return (
    <EmailLayout preview={t("preview")} title={t("title")} locale={locale}>
      <Text style={textStyles.body}>{t("greeting", { userName })}</Text>
      <Text style={textStyles.body}>
        {t("body", { attempts, minutes })}
      </Text>
      <Text style={textStyles.body}>{t("ifYou")}</Text>
      <Text style={textStyles.meta}>{t("support")}</Text>
    </EmailLayout>
  );
}

AccountLockoutEmail.PreviewProps = {
  userName: "Alex",
  attempts: 5,
  minutes: 15,
  locale: "en",
} satisfies AccountLockoutProps;

export default AccountLockoutEmail;
