import { Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { withEmailOverrides } from "@/lib/email/template-text";
import { EmailLayout, textStyles } from "./_layout";

// Sent the moment someone becomes an ACTIVE participant on a ticket — a staff
// member added them, the requester picked them, or a coordinator approved a
// pending request.
//
// Deliberately NOT sent while a request is still pending: that address hasn't
// been vouched for by anyone yet, and the subject line alone would leak what
// the ticket is about. By the time this sends, a human has decided.
export type ParticipantAddedProps = {
  /** Who is being added (may be null — we only ever have a name if someone
   *  typed one or it came from their account). */
  participantName: string | null;
  ticketNumber: string;
  subject: string;
  /** The requester, so the recipient knows whose ticket they've joined. */
  customerName: string;
  /** Guest link minted for THIS participant's own address. */
  ticketUrl: string;
  locale: string;
};

export async function ParticipantAddedEmail({
  participantName,
  ticketNumber,
  subject,
  customerName,
  ticketUrl,
  locale,
}: ParticipantAddedProps) {
  const t = await withEmailOverrides(
    "participantAdded",
    locale,
    await getTranslations({ locale, namespace: "emails.participantAdded" }),
  );
  return (
    <EmailLayout
      preview={t("preview", { ticketNumber })}
      title={t("title")}
      ticketNumber={ticketNumber}
      locale={locale}
    >
      <Text style={textStyles.body}>
        {participantName ? t("greetingNamed", { participantName }) : t("greeting")}
      </Text>
      <Text style={textStyles.body}>
        {t("body", { ticketNumber, subject, customerName })}
      </Text>
      <Text style={textStyles.body}>{t("cta")}</Text>
      <Link href={ticketUrl} style={textStyles.button}>
        {t("buttonView")}
      </Link>
      <Text style={textStyles.meta}>{t("replyHint")}</Text>
    </EmailLayout>
  );
}

ParticipantAddedEmail.PreviewProps = {
  participantName: "Jamie",
  ticketNumber: "KI-20260522-001",
  subject: "Laptop won't connect to the VPN",
  customerName: "Alex Buyer",
  ticketUrl: "https://tickets.axiom360.it/portal/guest/tickets/KI-20260522-001?token=abc",
  locale: "en",
} satisfies ParticipantAddedProps;

export default ParticipantAddedEmail;
