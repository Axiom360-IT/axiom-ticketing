import { getTranslations } from "next-intl/server";
import { ComingSoon } from "@/components/shared/coming-soon";

export default async function ProcurementPage() {
  const t = await getTranslations("admin.stubs");
  return (
    <ComingSoon
      title={t("procurementTitle")}
      description={t("procurementDescription")}
      module={t("procurementModule")}
    />
  );
}
