import { Hr, Link, Section, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

// Three emoji feedback buttons. Colors mirror the in-app emoji picker
// (green / amber / red). Emoji are rendered as text so they display across
// email clients that don't load remote images.
const baseCsatButton = {
  borderRadius: "6px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "14px",
  fontWeight: 500,
  marginRight: "8px",
  padding: "10px 16px",
  textDecoration: "none",
} as const;

const csatButtonStyles = {
  happy: { ...baseCsatButton, backgroundColor: "#15803d" },
  neutral: { ...baseCsatButton, backgroundColor: "#b45309" },
  unhappy: { ...baseCsatButton, backgroundColor: "#b91c1c", marginRight: "0" },
} as const;

export type TicketResolvedProps = {
  ticketNumber: string;
  customerName: string;
  subject: string;
  agentName: string;
  resolutionNote: string;
  csatHappyUrl: string;
  csatNeutralUrl: string;
  csatUnhappyUrl: string;
  trackingUrl: string;
  locale: string;
};

export async function TicketResolvedEmail({
  ticketNumber,
  customerName,
  subject,
  agentName,
  resolutionNote,
  csatHappyUrl,
  csatNeutralUrl,
  csatUnhappyUrl,
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
        <Link href={csatHappyUrl} style={csatButtonStyles.happy}>
          {t("happyButton")}
        </Link>
        <Link href={csatNeutralUrl} style={csatButtonStyles.neutral}>
          {t("neutralButton")}
        </Link>
        <Link href={csatUnhappyUrl} style={csatButtonStyles.unhappy}>
          {t("unhappyButton")}
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
  csatHappyUrl: "https://tickets.axiom360.it/csat?t=AX-0042&tk=access&r=happy",
  csatNeutralUrl:
    "https://tickets.axiom360.it/csat?t=AX-0042&tk=access&r=neutral",
  csatUnhappyUrl:
    "https://tickets.axiom360.it/csat?t=AX-0042&tk=access&r=unhappy",
  trackingUrl: "https://tickets.axiom360.it/portal/tickets/AX-0042?token=abc",
  locale: "en",
} satisfies TicketResolvedProps;

export default TicketResolvedEmail;
