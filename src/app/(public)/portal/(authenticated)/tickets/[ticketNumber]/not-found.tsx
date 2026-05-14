import Link from "next/link";
import { useTranslations } from "next-intl";

export default function PortalTicketNotFound() {
  const t = useTranslations("portal.errors");
  const tList = useTranslations("portal.tickets.list");
  return (
    <div className="max-w-3xl mx-auto py-16 px-4 text-center">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        {t("ticketNotFound")}
      </h1>
      <Link
        href="/portal/tickets"
        className="mt-6 inline-block text-sm text-blue-600 dark:text-blue-400 hover:underline"
      >
        {tList("title")}
      </Link>
    </div>
  );
}
