import { Link, Text } from "@react-email/components";
import { EmailLayout, textStyles } from "./_layout";

export type TicketCreatedProps = {
  ticketNumber: string;
  customerName: string;
  subject: string;
  trackingUrl: string;
};

export function TicketCreatedEmail({
  ticketNumber,
  customerName,
  subject,
  trackingUrl,
}: TicketCreatedProps) {
  return (
    <EmailLayout
      preview={`Your ticket ${ticketNumber} has been received`}
      title="We've received your ticket"
      ticketNumber={ticketNumber}
    >
      <Text style={textStyles.body}>Hi {customerName},</Text>
      <Text style={textStyles.body}>
        Thanks for reaching out. Your ticket <strong>{ticketNumber}</strong> —
        “{subject}” — has been received and a coordinator will assign it to a
        technician shortly.
      </Text>
      <Text style={textStyles.body}>
        You&apos;ll hear from us as soon as it&apos;s assigned. To add details
        or a screenshot, just reply to this email.
      </Text>
      <Link href={trackingUrl} style={textStyles.button}>
        View your ticket
      </Link>
      <Text style={textStyles.meta}>
        If the link above doesn&apos;t work, copy and paste this URL into your
        browser:
        <br />
        {trackingUrl}
      </Text>
    </EmailLayout>
  );
}

TicketCreatedEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  customerName: "Alex",
  subject: "Outlook is stuck on the splash screen",
  trackingUrl: "https://tickets.axiom360.it/portal/tickets/AX-0042?token=abc",
} satisfies TicketCreatedProps;

export default TicketCreatedEmail;
