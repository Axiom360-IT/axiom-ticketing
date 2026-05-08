import { Hr, Link, Section, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

export type TicketResolvedProps = {
  ticketNumber: string;
  customerName: string;
  subject: string;
  agentName: string;
  resolutionNote: string;
  csatSatisfiedUrl: string;
  csatUnsatisfiedUrl: string;
  trackingUrl: string;
  locale: string;
};

export async function TicketResolvedEmail({
  ticketNumber,
  customerName,
  subject,
  agentName,
  resolutionNote,
  csatSatisfiedUrl,
  csatUnsatisfiedUrl,
  trackingUrl,
  locale,
}: TicketResolvedProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.ticketResolved",
  });
  const paragraphs = resolutionNote
    .split(/\n\s*\n/)
    .filter((p) => p.trim().length > 0);

  return (
    <EmailLayout
      preview={t("preview", { ticketNumber })}
      title={t("title")}
      ticketNumber={ticketNumber}
      locale={locale}
    >
      <Text style={textStyles.body}>{t("greeting", { customerName })}</Text>
      <Text style={textStyles.body}>
        {t("body", { agentName, ticketNumber, subject })}
      </Text>

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

      <Text style={textStyles.body}>{t("feedbackPrompt")}</Text>

      <Section style={{ margin: "16px 0" }}>
        <Link href={csatSatisfiedUrl} style={textStyles.buttonGood}>
          {t("satisfiedButton")}
        </Link>
        <Link href={csatUnsatisfiedUrl} style={textStyles.buttonBad}>
          {t("unsatisfiedButton")}
        </Link>
      </Section>

      <Hr
        style={{
          border: "none",
          borderTop: "1px solid #e4e7eb",
          margin: "20px 0 10px",
        }}
      />
      <Text style={textStyles.meta}>
        {t.rich("viewLine", {
          link: (chunks) => (
            <Link href={trackingUrl} style={{ color: "#1e40af" }}>
              {chunks}
            </Link>
          ),
        })}
      </Text>
    </EmailLayout>
  );
}

TicketResolvedEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  customerName: "Alex",
  subject: "Outlook is stuck on the splash screen",
  agentName: "Priya",
  resolutionNote:
    "I cleared the corrupt Outlook profile cache from your account. Please restart Outlook and let me know if it loads past the splash screen now.",
  csatSatisfiedUrl:
    "https://tickets.axiom360.it/csat/confirm?t=AX-0042&tk=satisfied-token",
  csatUnsatisfiedUrl:
    "https://tickets.axiom360.it/csat/confirm?t=AX-0042&tk=unsatisfied-token",
  trackingUrl: "https://tickets.axiom360.it/portal/tickets/AX-0042?token=abc",
  locale: "en",
} satisfies TicketResolvedProps;

export default TicketResolvedEmail;
