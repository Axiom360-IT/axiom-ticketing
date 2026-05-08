import { getTranslations } from "next-intl/server";
import { ComingSoon } from "@/components/shared/coming-soon";

export default async function SettingsPage() {
  const t = await getTranslations("admin.stubs");
  return (
    <ComingSoon
      title={t("settingsTitle")}
      description={t("settingsDescription")}
      module={t("settingsModule")}
    />
  );
}
