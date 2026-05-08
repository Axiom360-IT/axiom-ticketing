import { Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

// Sent when a customer emails support but we can't match their reply to
// any open ticket (no `ticket+AX-XXXX` address, no [AX-XXXX] in subject,
// and no In-Reply-To/References we recognize). Tells them to open a fresh
// ticket via the portal so we don't silently drop the conversation.
export type InboundBounceProps = {
  customerName: string;
  newTicketUrl: string;
  locale: string;
};

export async function InboundBounceEmail({
  customerName,
  newTicketUrl,
  locale,
}: InboundBounceProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.inboundBounce",
  });
  return (
    <EmailLayout
      preview={t("preview")}
      title={t("title")}
      locale={locale}
    >
      <Text style={textStyles.body}>{t("greeting", { customerName })}</Text>
      <Text style={textStyles.body}>{t("body")}</Text>
      <Text style={textStyles.body}>{t("cta")}</Text>
      <Link href={newTicketUrl} style={textStyles.button}>
        {t("buttonNewTicket")}
      </Link>
    </EmailLayout>
  );
}

InboundBounceEmail.PreviewProps = {
  customerName: "Alex",
  newTicketUrl: "https://tickets.axiom360.it/portal/submit",
  locale: "en",
} satisfies InboundBounceProps;

export default InboundBounceEmail;
