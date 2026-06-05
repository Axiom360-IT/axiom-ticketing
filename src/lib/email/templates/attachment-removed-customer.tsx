import { Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

// Customer-facing counterpart to attachment-quarantined. When the uploader is
// the customer themselves, they must NOT get the staff version (which links to
// /admin and names the internal virus signature, req 6.3). This one explains
// in plain language that the file was removed by a security scan, points at
// their portal ticket, and omits the signature detail.
export type AttachmentRemovedCustomerProps = {
  customerName: string;
  ticketNumber: string;
  fileName: string;
  portalUrl: string;
  locale: string;
};

export async function AttachmentRemovedCustomerEmail({
  customerName,
  ticketNumber,
  fileName,
  portalUrl,
  locale,
}: AttachmentRemovedCustomerProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.attachmentRemovedCustomer",
  });
  return (
    <EmailLayout
      preview={t("preview", { ticketNumber })}
      title={t("title")}
      ticketNumber={ticketNumber}
      locale={locale}
    >
      <Text style={textStyles.body}>{t("greeting", { customerName })}</Text>
      <Text style={textStyles.body}>{t("body", { fileName, ticketNumber })}</Text>
      <Text style={textStyles.body}>{t("guidance")}</Text>
      <Link href={portalUrl} style={textStyles.button}>
        {t("view")}
      </Link>
    </EmailLayout>
  );
}

AttachmentRemovedCustomerEmail.PreviewProps = {
  customerName: "Alex Dean",
  ticketNumber: "AX-0042",
  fileName: "invoice.pdf",
  portalUrl: "https://tickets.axiom360.it/portal/tickets/AX-0042",
  locale: "en",
} satisfies AttachmentRemovedCustomerProps;

export default AttachmentRemovedCustomerEmail;
