import { Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { withEmailOverrides } from "@/lib/email/template-text";
import { EmailLayout, textStyles } from "./_layout";

// The message behind "Send a test email".
//
// Sent to an address that Resend has been refusing, to find out whether the
// block has been lifted. It has to make sense to a customer who has never heard
// of any of this and may be wondering why a support team is mailing them out of
// the blue, so it says plainly who asked, why, and that nothing is needed.
export type DeliveryTestProps = {
  /** The staff member who pressed the button. */
  requestedBy: string;
  locale: string;
};

export async function DeliveryTestEmail({ requestedBy, locale }: DeliveryTestProps) {
  const t = await withEmailOverrides(
    "deliveryTest",
    locale,
    await getTranslations({ locale, namespace: "emails.deliveryTest" }),
  );
  return (
    <EmailLayout preview={t("preview")} title={t("title")} locale={locale}>
      <Text style={textStyles.body}>{t("greeting")}</Text>
      <Text style={textStyles.body}>{t("body", { requestedBy })}</Text>
      <Text style={textStyles.body}>{t("noAction")}</Text>
    </EmailLayout>
  );
}

DeliveryTestEmail.PreviewProps = {
  requestedBy: "Evelyn",
  locale: "en",
} satisfies DeliveryTestProps;

export default DeliveryTestEmail;
