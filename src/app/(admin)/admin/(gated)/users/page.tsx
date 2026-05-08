import { getTranslations } from "next-intl/server";
import { ComingSoon } from "@/components/shared/coming-soon";

export default async function UsersPage() {
  const t = await getTranslations("admin.stubs");
  return (
    <ComingSoon
      title={t("usersTitle")}
      description={t("usersDescription")}
      module={t("usersModule")}
    />
  );
}
