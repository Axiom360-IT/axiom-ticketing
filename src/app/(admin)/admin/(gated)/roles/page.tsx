import { getTranslations } from "next-intl/server";
import { ComingSoon } from "@/components/shared/coming-soon";

export default async function RolesPage() {
  const t = await getTranslations("admin.stubs");
  return (
    <ComingSoon
      title={t("rolesTitle")}
      description={t("rolesDescription")}
      module={t("rolesModule")}
    />
  );
}
