import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CustomerNewTicketForm } from "@/components/customer/customer-new-ticket-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.tickets.new");
  return { title: t("metaTitle") };
}

export default async function PortalNewTicketPage() {
  const t = await getTranslations("portal.tickets.new");
  return (
    <section className="max-w-2xl mx-auto py-10 px-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        {t("title")}
      </h1>
      <p className="mt-1 mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        {t("subtitle")}
      </p>
      <CustomerNewTicketForm />
    </section>
  );
}
