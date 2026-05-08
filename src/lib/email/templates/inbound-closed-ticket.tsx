import { Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

// Sent when a customer replies to a ticket that's already closed. We
// don't reopen on email — that would let "thanks!" reopen anything for
// no reason. Instead we point them at the portal to file a fresh ticket
// (or contact support) and reference the closed ticket for context.
export type InboundClosedTicketProps = {
  customerName: string;
  ticketNumber: string;
  newTicketUrl: string;
  locale: string;
};

export async function InboundClosedTicketEmail({
  customerName,
  ticketNumber,
  newTicketUrl,
  locale,
}: InboundClosedTicketProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.inboundClosedTicket",
  });
  return (
    <EmailLayout
      preview={t("preview", { ticketNumber })}
      title={t("title")}
      ticketNumber={ticketNumber}
      locale={locale}
    >
      <Text style={textStyles.body}>{t("greeting", { customerName })}</Text>
      <Text style={textStyles.body}>{t("body", { ticketNumber })}</Text>
      <Text style={textStyles.body}>{t("cta")}</Text>
      <Link href={newTicketUrl} style={textStyles.button}>
        {t("buttonNewTicket")}
      </Link>
    </EmailLayout>
  );
}

InboundClosedTicketEmail.PreviewProps = {
  customerName: "Alex",
  ticketNumber: "AX-0042",
  newTicketUrl: "https://tickets.axiom360.it/portal/submit",
  locale: "en",
} satisfies InboundClosedTicketProps;

export default InboundClosedTicketEmail;
