import { getTranslations } from "next-intl/server";
import { ComingSoon } from "@/components/shared/coming-soon";

export default async function HierarchyPage() {
  const t = await getTranslations("admin.stubs");
  return (
    <ComingSoon
      title={t("hierarchyTitle")}
      description={t("hierarchyDescription")}
      module={t("hierarchyModule")}
    />
  );
}
