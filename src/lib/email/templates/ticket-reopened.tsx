import { Link, Text } from "@react-email/components";
import { EmailLayout, textStyles } from "./_layout";

export type TicketReopenedProps = {
  ticketNumber: string;
  customerName: string;
  subject: string;
  // "csat_unsatisfied" — customer pressed "no" on CSAT email.
  // "agent" — a coordinator/agent reopened from the dashboard.
  reason: "csat_unsatisfied" | "agent";
  trackingUrl: string;
};

export function TicketReopenedEmail({
  ticketNumber,
  customerName,
  subject,
  reason,
  trackingUrl,
}: TicketReopenedProps) {
  return (
    <EmailLayout
      preview={`Ticket ${ticketNumber} has been reopened`}
      title="Your ticket has been reopened"
      ticketNumber={ticketNumber}
    >
      <Text style={textStyles.body}>Hi {customerName},</Text>
      {reason === "csat_unsatisfied" ? (
        <Text style={textStyles.body}>
          Sorry our last fix didn&apos;t do it. Ticket{" "}
          <strong>{ticketNumber}</strong> &ldquo;{subject}&rdquo; is reopened
          and we&apos;re back on it. A technician will follow up shortly.
        </Text>
      ) : (
        <Text style={textStyles.body}>
          Ticket <strong>{ticketNumber}</strong> &ldquo;{subject}&rdquo; has
          been reopened by our team and assigned for follow-up.
        </Text>
      )}
      <Text style={textStyles.body}>
        If there&apos;s any extra detail that would help us, just reply to this
        email and we&apos;ll add it to the ticket.
      </Text>
      <Link href={trackingUrl} style={textStyles.button}>
        View your ticket
      </Link>
    </EmailLayout>
  );
}

TicketReopenedEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  customerName: "Alex",
  subject: "Outlook is stuck on the splash screen",
  reason: "csat_unsatisfied",
  trackingUrl: "https://tickets.axiom360.it/portal/tickets/AX-0042?token=abc",
} satisfies TicketReopenedProps;

export default TicketReopenedEmail;
