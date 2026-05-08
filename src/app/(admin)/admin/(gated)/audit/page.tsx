import { getTranslations } from "next-intl/server";
import { ComingSoon } from "@/components/shared/coming-soon";

export default async function AuditPage() {
  const t = await getTranslations("admin.stubs");
  return (
    <ComingSoon
      title={t("auditTitle")}
      description={t("auditDescription")}
      module={t("auditModule")}
    />
  );
}
