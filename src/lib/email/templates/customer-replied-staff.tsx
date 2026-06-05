import { Hr, Link, Section, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

// Staff-facing "the customer replied" email. Distinct from the customer-facing
// `ticket_reply` template (which greets "Hi {customerName}" and says "View your
// ticket"): reusing that one for the assignee greeted the technician by the
// customer's name and addressed them in the customer's voice (req 6.3 misroute).
export type CustomerRepliedStaffProps = {
  ticketNumber: string;
  customerName: string;
  subject: string;
  body: string;
  ticketUrl: string;
  locale: string;
};

export async function CustomerRepliedStaffEmail({
  ticketNumber,
  customerName,
  subject,
  body,
  ticketUrl,
  locale,
}: CustomerRepliedStaffProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.customerRepliedStaff",
  });
  const paragraphs = body.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

  return (
    <EmailLayout
      preview={t("preview", { customerName, ticketNumber })}
      title={t("title")}
      ticketNumber={ticketNumber}
      locale={locale}
    >
      <Text style={textStyles.body}>{t("body", { customerName, ticketNumber })}</Text>
      <Text style={textStyles.meta}>{t("metaSubject", { subject })}</Text>

      <Section
        style={{
          backgroundColor: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: "6px",
          padding: "16px",
          margin: "16px 0",
        }}
      >
        {paragraphs.map((p, i) => (
          <Text
            key={i}
            style={{ ...textStyles.body, margin: i === 0 ? 0 : "12px 0 0 0" }}
          >
            {p}
          </Text>
        ))}
      </Section>

      <Link href={ticketUrl} style={textStyles.button}>
        {t("view")}
      </Link>
      <Hr
        style={{
          border: "none",
          borderTop: "1px solid #e4e7eb",
          margin: "20px 0 10px",
        }}
      />
      <Text style={textStyles.meta}>{t("trailerLine", { ticketNumber })}</Text>
    </EmailLayout>
  );
}

CustomerRepliedStaffEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  customerName: "Alex Dean",
  subject: "Outlook is stuck on the splash screen",
  body: "Hi — I tried restarting but it's still stuck. Can you take another look?",
  ticketUrl:
    "https://tickets.axiom360.it/admin/tickets/00000000-0000-0000-0000-000000000000",
  locale: "en",
} satisfies CustomerRepliedStaffProps;

export default CustomerRepliedStaffEmail;
