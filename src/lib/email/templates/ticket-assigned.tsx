import { Link, Text } from "@react-email/components";
import { EmailLayout, textStyles } from "./_layout";

export type TicketAssignedProps = {
  ticketNumber: string;
  customerName: string;
  subject: string;
  technicianName: string;
  trackingUrl: string;
};

export function TicketAssignedEmail({
  ticketNumber,
  customerName,
  subject,
  technicianName,
  trackingUrl,
}: TicketAssignedProps) {
  return (
    <EmailLayout
      preview={`Your ticket ${ticketNumber} is now being worked on`}
      title="Your ticket is now being worked on"
      ticketNumber={ticketNumber}
    >
      <Text style={textStyles.body}>Hi {customerName},</Text>
      <Text style={textStyles.body}>
        Good news — <strong>{technicianName}</strong> has picked up your ticket
        <strong> {ticketNumber}</strong> and is looking into{" "}
        &ldquo;{subject}&rdquo;.
      </Text>
      <Text style={textStyles.body}>
        You&apos;ll get an update as soon as they have something to share.
        You can also reply to this email at any time to add details.
      </Text>
      <Link href={trackingUrl} style={textStyles.button}>
        View your ticket
      </Link>
    </EmailLayout>
  );
}

TicketAssignedEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  customerName: "Alex",
  subject: "Outlook is stuck on the splash screen",
  technicianName: "Priya",
  trackingUrl: "https://tickets.axiom360.it/portal/tickets/AX-0042?token=abc",
} satisfies TicketAssignedProps;

export default TicketAssignedEmail;
