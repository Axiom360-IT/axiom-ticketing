import { Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

// Sent to the uploader and the assigned tech when the virus scanner
// flags an attachment (M18 Phase B). Tells them which file, which
// signature matched, and links them to the ticket. The bytes have
// already been deleted from R2 by the time this fires.
export type AttachmentQuarantinedProps = {
  recipientName: string;
  ticketNumber: string;
  ticketSubject: string;
  fileName: string;
  signature: string;
  ticketUrl: string;
  locale: string;
};

export async function AttachmentQuarantinedEmail({
  recipientName,
  ticketNumber,
  ticketSubject,
  fileName,
  signature,
  ticketUrl,
  locale,
}: AttachmentQuarantinedProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.attachmentQuarantined",
  });
  return (
    <EmailLayout
      preview={t("preview", { ticketNumber })}
      title={t("title")}
      ticketNumber={ticketNumber}
      locale={locale}
    >
      <Text style={textStyles.body}>{t("greeting", { recipientName })}</Text>
      <Text style={textStyles.body}>
        {t("body", { fileName, signature, subject: ticketSubject })}
      </Text>
      <Text style={textStyles.meta}>{t("note")}</Text>
      <Link href={ticketUrl} style={textStyles.button}>
        {t("button")}
      </Link>
    </EmailLayout>
  );
}

AttachmentQuarantinedEmail.PreviewProps = {
  recipientName: "Alex",
  ticketNumber: "AX-1042",
  ticketSubject: "Laptop won't boot",
  fileName: "report.pdf",
  signature: "Eicar-Test-Signature",
  ticketUrl: "https://tickets.axiom360.it/admin/tickets/abc",
  locale: "en",
} satisfies AttachmentQuarantinedProps;

export default AttachmentQuarantinedEmail;
