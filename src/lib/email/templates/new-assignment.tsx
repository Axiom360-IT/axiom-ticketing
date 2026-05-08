import { Link, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { EmailLayout, textStyles } from "./_layout";

export type NewAssignmentProps = {
  ticketNumber: string;
  technicianName: string;
  subject: string;
  priority: "low" | "medium" | "high" | "critical";
  customerName: string;
  ticketUrl: string;
  locale: string;
};

export async function NewAssignmentEmail({
  ticketNumber,
  technicianName,
  subject,
  priority,
  customerName,
  ticketUrl,
  locale,
}: NewAssignmentProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.newAssignment",
  });
  const tPriority = await getTranslations({
    locale,
    namespace: "tickets.priority",
  });
  return (
    <EmailLayout
      preview={t("preview", { ticketNumber })}
      title={t("title")}
      ticketNumber={ticketNumber}
      locale={locale}
    >
      <Text style={textStyles.body}>{t("greeting", { technicianName })}</Text>
      <Text style={textStyles.body}>
        {t("body", { ticketNumber, subject })}
      </Text>
      <Text style={textStyles.meta}>
        {t("meta", { customerName, priority: tPriority(priority) })}
      </Text>
      <Link href={ticketUrl} style={textStyles.button}>
        {t("view")}
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
  locale: "en",
} satisfies NewAssignmentProps;

export default NewAssignmentEmail;
