import { Hr, Link, Section, Text } from "@react-email/components";
import { EmailLayout, textStyles } from "./_layout";

export type TicketReplyProps = {
  ticketNumber: string;
  customerName: string;
  subject: string;
  agentName: string;
  body: string;
  trackingUrl: string;
};

export function TicketReplyEmail({
  ticketNumber,
  customerName,
  subject,
  agentName,
  body,
  trackingUrl,
}: TicketReplyProps) {
  // Simple paragraph splitter so the reply body shows nicely
  const paragraphs = body.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

  return (
    <EmailLayout
      preview={`${agentName} replied to your ticket ${ticketNumber}`}
      title={`${agentName} replied to your ticket`}
      ticketNumber={ticketNumber}
    >
      <Text style={textStyles.body}>Hi {customerName},</Text>
      <Text style={textStyles.body}>
        We&apos;ve sent you an update on{" "}
        <strong>&ldquo;{subject}&rdquo;</strong>:
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
        You can reply to this email to keep the conversation going, or open
        the ticket in your browser.
      </Text>
      <Link href={trackingUrl} style={textStyles.button}>
        View your ticket
      </Link>
      <Hr
        style={{
          border: "none",
          borderTop: "1px solid #e4e7eb",
          margin: "20px 0 10px",
        }}
      />
      <Text style={textStyles.meta}>
        Reply to this email or click the link above to respond. Mention
        ticket {ticketNumber} if your mail client doesn&apos;t keep the thread.
      </Text>
    </EmailLayout>
  );
}

TicketReplyEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  customerName: "Alex",
  subject: "Outlook is stuck on the splash screen",
  agentName: "Priya",
  body: "Hi Alex,\n\nI've cleared your Outlook profile cache from our end. Could you reopen Outlook now and let me know if it loads past the splash screen?\n\nThanks,\nPriya",
  trackingUrl: "https://tickets.axiom360.it/portal/tickets/AX-0042?token=abc",
} satisfies TicketReplyProps;

export default TicketReplyEmail;
