import { Link, Section, Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import type { BillingCategory, BillingStatus } from "@/lib/billing/outcome";
import { EmailLayout, textStyles } from "./_layout";

// Accountant billing summary sent when a ticket is resolved (req 8.9). Reports
// the work category, hours, and the derived outcome (billed / pending / nothing
// to bill / needs review) so the accountant can act.
export type AccountantTicketBillingProps = {
  ticketNumber: string;
  orgName: string;
  category: BillingCategory;
  hours: string;
  /** Over-plan hours for the "pending" Monthly-Support case; the literal
   *  "none" otherwise (the ICU sentinel for "no overage"). */
  overHours: string;
  status: BillingStatus;
  ticketUrl: string;
  locale: string;
};

const STATUS_COLOR: Record<BillingStatus, string> = {
  billed: "#047857",
  pending: "#b45309",
  none: "#52525b",
  review: "#b91c1c",
};

export async function AccountantTicketBillingEmail({
  ticketNumber,
  orgName,
  category,
  hours,
  overHours,
  status,
  ticketUrl,
  locale,
}: AccountantTicketBillingProps) {
  const t = await getTranslations({
    locale,
    namespace: "emails.accountantTicketBilling",
  });
  const categoryLabel = t(`categories.${category}` as `categories.${BillingCategory}`);
  const statusLine = t(`status.${status}` as `status.${BillingStatus}`, {
    overHours,
  });

  return (
    <EmailLayout
      preview={t("preview", { ticketNumber, orgName })}
      title={t("title")}
      ticketNumber={ticketNumber}
      locale={locale}
    >
      <Text style={textStyles.body}>{t("intro", { ticketNumber, orgName })}</Text>
      <Section
        style={{
          backgroundColor: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: "6px",
          padding: "16px",
          margin: "16px 0",
        }}
      >
        <Text style={{ ...textStyles.meta, margin: 0 }}>
          {t("rowCategory", { category: categoryLabel })}
        </Text>
        <Text style={{ ...textStyles.meta, margin: "6px 0 0 0" }}>
          {t("rowHours", { hours })}
        </Text>
        <Text
          style={{
            ...textStyles.body,
            margin: "10px 0 0 0",
            fontWeight: 600,
            color: STATUS_COLOR[status],
          }}
        >
          {statusLine}
        </Text>
      </Section>
      <Link href={ticketUrl} style={textStyles.button}>
        {t("view")}
      </Link>
    </EmailLayout>
  );
}

AccountantTicketBillingEmail.PreviewProps = {
  ticketNumber: "AX-0042",
  orgName: "Kingsmill Foods",
  category: "project",
  hours: "4h",
  overHours: "none",
  status: "pending",
  ticketUrl: "https://tickets.axiom360.it/admin/tickets/00000000-0000-0000-0000-000000000000",
  locale: "en",
} satisfies AccountantTicketBillingProps;

export default AccountantTicketBillingEmail;
