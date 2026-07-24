import Link from "next/link";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { CsatLandingForm } from "@/components/customer/csat-landing-form";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema/tickets";
import { isCsatRating } from "@/lib/tickets/csat";
import { verifyCsatAccessToken } from "@/lib/tokens";

// Hosted CSAT feedback page — the landing spot for the emoji links in the
// resolution email. The access token authorizes feedback for one ticket; the
// rating is chosen (or changed) here and submitted with an optional comment
// (mandatory when unhappy). Tokened URLs are noindex.
export async function generateMetadata() {
  const t = await getTranslations("tickets.csat");
  return { title: t("pageTitle"), robots: { index: false } };
}

type SearchParams = Promise<{ t?: string; tk?: string; r?: string }>;

function Card({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta: string;
}) {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-16 px-4 flex items-start justify-center">
      <div className="max-w-md w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-sm p-8 text-center space-y-4">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          {title}
        </h1>
        <p className="text-zinc-600 dark:text-zinc-300">{body}</p>
        <div className="pt-2">
          <Link
            href="/portal/submit"
            className="text-sm font-medium text-blue-700 dark:text-blue-400 hover:underline"
          >
            {cta}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default async function CsatPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { t: ticketNumber, tk: token, r } = await searchParams;
  const tt = await getTranslations("tickets.csat");

  if (!ticketNumber || !token || !verifyCsatAccessToken(token, ticketNumber)) {
    return (
      <Card
        title={tt("invalidTitle")}
        body={tt("invalidBody")}
        cta={tt("submitAnother")}
      />
    );
  }

  const [ticket] = await db
    .select({
      ticketNumber: tickets.ticketNumber,
      csatResponse: tickets.csatResponse,
    })
    .from(tickets)
    .where(eq(tickets.ticketNumber, ticketNumber))
    .limit(1);

  if (!ticket) {
    return (
      <Card
        title={tt("invalidTitle")}
        body={tt("invalidBody")}
        cta={tt("submitAnother")}
      />
    );
  }
  if (ticket.csatResponse) {
    return (
      <Card
        title={tt("pageTitle")}
        body={tt("alreadyResponded")}
        cta={tt("submitAnother")}
      />
    );
  }

  const initialRating = isCsatRating(r) ? r : null;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-16 px-4 flex items-start justify-center">
      <div className="max-w-md w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-sm p-8">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50 text-center">
          {tt("pageTitle")}
        </h1>
        <p className="mt-2 mb-6 text-center text-zinc-600 dark:text-zinc-300">
          {tt("pageSubtitle", { ticketNumber })}
        </p>
        <CsatLandingForm
          ticketNumber={ticketNumber}
          token={token}
          initialRating={initialRating}
        />
      </div>
    </div>
  );
}
