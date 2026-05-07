import { Hr, Link, Section, Text } from "@react-email/components";
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
};

export function TicketResolvedEmail({
  ticketNumber,
  customerName,
  subject,
  agentName,
  resolutionNote,
  csatSatisfiedUrl,
  csatUnsatisfiedUrl,
  trackingUrl,
}: TicketResolvedProps) {
  const paragraphs = resolutionNote
    .split(/\n\s*\n/)
    .filter((p) => p.trim().length > 0);

  return (
    <EmailLayout
      preview={`Your ticket ${ticketNumber} has been resolved`}
      title="Your ticket has been resolved"
      ticketNumber={ticketNumber}
    >
      <Text style={textStyles.body}>Hi {customerName},</Text>
      <Text style={textStyles.body}>
        <strong>{agentName}</strong> has resolved your ticket{" "}
        <strong>{ticketNumber}</strong> &mdash;{" "}
        <strong>&ldquo;{subject}&rdquo;</strong>. Here&apos;s what they did:
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

      <Text style={textStyles.body}>
        Did this fix the issue? Your feedback closes the loop. If we
        don&apos;t hear back within 24 hours, the ticket will close
        automatically.
      </Text>

      <Section style={{ margin: "16px 0" }}>
        <Link href={csatSatisfiedUrl} style={textStyles.buttonGood}>
          Yes, this is fixed
        </Link>
        <Link href={csatUnsatisfiedUrl} style={textStyles.buttonBad}>
          No, this isn&apos;t fixed
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
        You can also{" "}
        <Link href={trackingUrl} style={{ color: "#1e40af" }}>
          view the ticket
        </Link>{" "}
        or reply to this email if you need to add more details.
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
} satisfies TicketResolvedProps;

export default TicketResolvedEmail;
