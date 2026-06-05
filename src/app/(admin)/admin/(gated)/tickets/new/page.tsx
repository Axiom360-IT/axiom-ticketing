import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateOnBehalfForm } from "@/components/tickets/create-on-behalf-form";
import { listActiveOrganizations } from "@/app/actions/organizations";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";

export async function generateMetadata() {
  const t = await getTranslations("tickets.createOnBehalf");
  return { title: t("title") };
}

export default async function NewTicketPage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  const allowed = await can(
    user,
    "tickets.create",
    { type: "global" },
    productionContext,
  );
  if (!allowed) redirect("/admin/tickets");

  // Offer the org dropdown when the agent can read the registry (CR-02).
  const canViewOrgs = await can(
    user,
    "organizations.view",
    { type: "global" },
    productionContext,
  );
  const organizations = canViewOrgs
    ? (await listActiveOrganizations()).map((o) => ({ id: o.id, name: o.name }))
    : [];

  const t = await getTranslations("tickets.createOnBehalf");

  return (
    <div className="max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold sm:text-2xl">{t("title")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t("subtitle")}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("cardTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateOnBehalfForm organizations={organizations} />
        </CardContent>
      </Card>
    </div>
  );
}
