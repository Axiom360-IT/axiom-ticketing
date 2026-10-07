import { Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { withEmailOverrides } from "@/lib/email/template-text";
import { EmailLayout, textStyles } from "./_layout";

// An automation rule's own message.
//
// Unlike every other template here, the BODY is not ours — an operator wrote
// it in the rule builder and it arrives as `message`, already
// placeholder-substituted. So this component is deliberately plain chrome:
// what they said, which ticket it is about, and what sent it. Wrapping an
// operator's sentence in our own prose would make the email read as two
// voices arguing.
//
// `subjectLine` is computed by the executor (the rule's own subject, or a
// generated one) and is carried as a prop purely so `defaultSubject` in
// send.tsx picks it up — that function harvests every primitive field off
// `data` for the subject's placeholders. Deciding the wording in TypeScript
// rather than branching inside an ICU message keeps both readable.
//
// `ruleName` is here because the first question on receiving an unexpected
// automated email is "what sent me this?", and the answer has to be enough to
// go and switch it off.
export type AutomationRuleProps = {
  ruleName: string;
  subjectLine: string;
  /** The operator-written message, already placeholder-substituted. */
  message: string;
  /** Present when the rule fired for a specific ticket. */
  ticketNumber?: string;
  ticketSubject?: string;
  adminUrl?: string;
  locale: string;
};

export async function AutomationRuleEmail({
  ruleName,
  subjectLine,
  message,
  ticketNumber,
  ticketSubject,
  adminUrl,
  locale,
}: AutomationRuleProps) {
  const t = await withEmailOverrides(
    "automationRule",
    locale,
    await getTranslations({ locale, namespace: "emails.automationRule" }),
  );
  return (
    <EmailLayout
      preview={subjectLine}
      title={subjectLine}
      locale={locale}
    >
      <Text style={textStyles.body}>{message}</Text>
      {ticketNumber ? (
        <Text style={textStyles.body}>
          {t("ticketLine", {
            ticketNumber,
            subject: ticketSubject ?? "",
          })}
        </Text>
      ) : null}
      {adminUrl ? (
        <Text style={textStyles.body}>{t("openLine", { adminUrl })}</Text>
      ) : null}
      <Text style={textStyles.meta}>{t("sentBy", { ruleName })}</Text>
    </EmailLayout>
  );
}

AutomationRuleEmail.PreviewProps = {
  ruleName: "Chase a critical ticket nobody picked up",
  subjectLine: "AX-0042 has had no owner for 30 minutes",
  message:
    "AX-0042 is marked Critical and still has no owner after 30 minutes. Please pick it up or reassign it.",
  ticketNumber: "AX-0042",
  ticketSubject: "Server room air conditioning has failed",
  adminUrl: "https://support.axiom360.it/admin/tickets/abc",
  locale: "en",
} satisfies AutomationRuleProps;

export default AutomationRuleEmail;
