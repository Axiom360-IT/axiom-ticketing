import { getTranslations } from "next-intl/server";
import { ComingSoon } from "@/components/shared/coming-soon";

export default async function ProfilePage() {
  const t = await getTranslations("admin.stubs");
  return (
    <ComingSoon
      title={t("profileTitle")}
      description={t("profileDescription")}
      module={t("profileModule")}
    />
  );
}
