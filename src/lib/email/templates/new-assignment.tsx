import { Link, Text } from "@react-email/components";
import { EmailLayout, textStyles } from "./_layout";

export type NewAssignmentProps = {
  ticketNumber: string;
  technicianName: string;
  subject: string;
  priority: "low" | "medium" | "high" | "critical";
  customerName: string;
  ticketUrl: string;
};

const PRIORITY_LABEL: Record<NewAssignmentProps["priority"], string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "CRITICAL",
};

export function NewAssignmentEmail({
  ticketNumber,
  technicianName,
  subject,
  priority,
  customerName,
  ticketUrl,
}: NewAssignmentProps) {
  return (
    <EmailLayout
      preview={`Ticket ${ticketNumber} has been assigned to you`}
      title="A ticket has been assigned to you"
      ticketNumber={ticketNumber}
    >
      <Text style={textStyles.body}>Hi {technicianName},</Text>
      <Text style={textStyles.body}>
        You&apos;ve been assigned ticket <strong>{ticketNumber}</strong>.
      </Text>
      <Text style={textStyles.meta}>
        <strong>Subject:</strong> {subject}
        <br />
        <strong>Priority:</strong> {PRIORITY_LABEL[priority]}
        <br />
        <strong>Customer:</strong> {customerName}
      </Text>
      <Link href={ticketUrl} style={textStyles.button}>
        Open ticket
      </Link>
    </EmailLayout>
  );
}

NewAssignmentEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  technicianName: "Priya",
  subject: "Outlook is stuck on the splash screen",
  priority: "high",
  customerName: "Alex Dean",
  ticketUrl: "https://tickets.axiom360.it/admin/tickets/00000000-0000-0000-0000-000000000000",
} satisfies NewAssignmentProps;

export default NewAssignmentEmail;
