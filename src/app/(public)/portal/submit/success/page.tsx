import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CheckCircle2 } from "lucide-react";

type SuccessPageProps = {
  searchParams: Promise<{ ticket?: string }>;
};

export async function generateMetadata() {
  const t = await getTranslations("tickets.submitSuccess");
  return { title: t("metaTitle") };
}

export default async function SuccessPage({ searchParams }: SuccessPageProps) {
  const { ticket } = await searchParams;
  const t = await getTranslations("tickets.submitSuccess");
  const ticketNumber = ticket ?? t("fallbackTicket");

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-sm p-8 text-center">
        <div className="flex justify-center mb-4">
          <div className="w-12 h-12 rounded-full bg-green-50 dark:bg-green-950 flex items-center justify-center">
            <CheckCircle2
              className="w-6 h-6 text-green-600 dark:text-green-400"
              aria-hidden="true"
            />
          </div>
        </div>

        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
          {t("title")}
        </h1>

        <p className="text-zinc-600 dark:text-zinc-400 mb-6">
          {t.rich("ticketNumberLine", {
            ticket: () => (
              <code className="font-mono font-medium text-zinc-900 dark:text-zinc-50 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                {ticketNumber}
              </code>
            ),
          })}
        </p>

        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
          {t("trackingHelp")}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/portal/submit"
            className="inline-flex items-center justify-center px-4 py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors min-h-[44px]"
          >
            {t("submitAnother")}
          </Link>
        </div>
      </div>
    </div>
  );
}
