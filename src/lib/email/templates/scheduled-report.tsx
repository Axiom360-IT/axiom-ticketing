import { Text } from "@react-email/components";
import { getTranslations } from "next-intl/server";
import { withEmailOverrides } from "@/lib/email/template-text";
import { EmailLayout, textStyles } from "./_layout";

// The covering note for a scheduled report. The report itself is attached, so
// this is deliberately short: what it is, which period it covers, and who to
// talk to about changing it. No link to the app — the point of a scheduled
// report is that the recipient does not have to sign in to read the number.
export type ScheduledReportProps = {
  /** What the schedule was named, e.g. "Daily operations report". */
  reportName: string;
  /** The local date this run covers, YYYY-MM-DD. */
  forDate: string;
  rangeDays: number;
  fileName: string;
  locale: string;
};

export async function ScheduledReportEmail({
  reportName,
  forDate,
  rangeDays,
  fileName,
  locale,
}: ScheduledReportProps) {
  const t = await withEmailOverrides(
    "scheduledReport",
    locale,
    await getTranslations({ locale, namespace: "emails.scheduledReport" }),
  );
  return (
    <EmailLayout
      preview={t("preview", { reportName })}
      title={t("title", { reportName })}
      locale={locale}
    >
      <Text style={textStyles.body}>{t("greeting")}</Text>
      <Text style={textStyles.body}>{t("body", { forDate, rangeDays })}</Text>
      <Text style={textStyles.body}>{t("attached", { fileName })}</Text>
      <Text style={textStyles.meta}>{t("manageHint")}</Text>
    </EmailLayout>
  );
}

ScheduledReportEmail.PreviewProps = {
  reportName: "Daily operations report",
  forDate: "2026-10-06",
  rangeDays: 1,
  fileName: "report-2026-10-06.xlsx",
  locale: "en",
} satisfies ScheduledReportProps;

export default ScheduledReportEmail;
