import { Link, Text } from "@react-email/components";
import { EmailLayout, textStyles } from "./_layout";

export type TicketClosedProps = {
  ticketNumber: string;
  customerName: string;
  subject: string;
  // "csat" — customer marked satisfied; "auto" — 24h auto-close after no CSAT.
  reason: "csat" | "auto";
  newTicketUrl: string;
};

export function TicketClosedEmail({
  ticketNumber,
  customerName,
  subject,
  reason,
  newTicketUrl,
}: TicketClosedProps) {
  return (
    <EmailLayout
      preview={`Ticket ${ticketNumber} is now closed`}
      title="Your ticket is closed"
      ticketNumber={ticketNumber}
    >
      <Text style={textStyles.body}>Hi {customerName},</Text>
      {reason === "csat" ? (
        <Text style={textStyles.body}>
          Thanks for confirming &mdash; ticket{" "}
          <strong>{ticketNumber}</strong> &ldquo;{subject}&rdquo; is now closed.
        </Text>
      ) : (
        <Text style={textStyles.body}>
          We hadn&apos;t heard back on ticket <strong>{ticketNumber}</strong>{" "}
          &ldquo;{subject}&rdquo;, so we&apos;ve closed it for you. If the issue
          comes back, just open a new ticket and we&apos;ll pick it up.
        </Text>
      )}
      <Text style={textStyles.body}>
        Need help with something else? Open a fresh ticket any time.
      </Text>
      <Link href={newTicketUrl} style={textStyles.button}>
        Submit a new ticket
      </Link>
    </EmailLayout>
  );
}

TicketClosedEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  customerName: "Alex",
  subject: "Outlook is stuck on the splash screen",
  reason: "csat",
  newTicketUrl: "https://tickets.axiom360.it/portal/submit",
} satisfies TicketClosedProps;

export default TicketClosedEmail;
