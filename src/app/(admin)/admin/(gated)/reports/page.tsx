import { getTranslations } from "next-intl/server";
import { ComingSoon } from "@/components/shared/coming-soon";

export default async function ReportsPage() {
  const t = await getTranslations("admin.stubs");
  return (
    <ComingSoon
      title={t("reportsTitle")}
      description={t("reportsDescription")}
      module={t("reportsModule")}
    />
  );
}
