import { Link, Text } from "@react-email/components";
import { EmailLayout, textStyles } from "./_layout";

export type EscalationAlertProps = {
  ticketNumber: string;
  recipientName: string;
  subject: string;
  technicianName: string;
  reason: string;
  customerName: string;
  ticketUrl: string;
};

export function EscalationAlertEmail({
  ticketNumber,
  recipientName,
  subject,
  technicianName,
  reason,
  customerName,
  ticketUrl,
}: EscalationAlertProps) {
  return (
    <EmailLayout
      preview={`Ticket ${ticketNumber} has been escalated`}
      title="A ticket has been escalated"
      ticketNumber={ticketNumber}
    >
      <Text style={textStyles.body}>Hi {recipientName},</Text>
      <Text style={textStyles.body}>
        <strong>{technicianName}</strong> has escalated ticket{" "}
        <strong>{ticketNumber}</strong> &ldquo;{subject}&rdquo;.
      </Text>
      <Text style={textStyles.meta}>
        <strong>Reason:</strong> {reason}
        <br />
        <strong>Customer:</strong> {customerName}
      </Text>
      <Text style={textStyles.body}>
        The ticket is still assigned to {technicianName}. Please review and
        either take it over, advise, or de-escalate when ready.
      </Text>
      <Link href={ticketUrl} style={textStyles.button}>
        Open ticket
      </Link>
    </EmailLayout>
  );
}

EscalationAlertEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  recipientName: "Evelyn",
  subject: "Outlook is stuck on the splash screen",
  technicianName: "Priya",
  reason: "Beyond technician scope — requires vendor escalation.",
  customerName: "Alex Dean",
  ticketUrl: "https://tickets.axiom360.it/admin/tickets/00000000-0000-0000-0000-000000000000",
} satisfies EscalationAlertProps;

export default EscalationAlertEmail;
