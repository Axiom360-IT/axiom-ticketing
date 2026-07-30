import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CustomerImportWizard } from "@/components/users/customer-import-wizard";
import { listActiveOrganizations } from "@/app/actions/organizations";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";

export async function generateMetadata() {
  const t = await getTranslations("users.import");
  return { title: t("metaTitle") };
}

export default async function ImportCustomersPage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (!(await can(user, "users.create", { type: "global" }, productionContext))) {
    redirect("/admin/users");
  }

  const t = await getTranslations("users.import");
  const canViewOrgs = await can(
    user,
    "organizations.view",
    { type: "global" },
    productionContext,
  );
  const organizations = canViewOrgs
    ? (await listActiveOrganizations()).map((o) => ({ id: o.id, name: o.name }))
    : [];

  return (
    <div className="max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold sm:text-2xl">{t("title")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("subtitle")}</p>
      </header>
      <CustomerImportWizard organizations={organizations} />
    </div>
  );
}
