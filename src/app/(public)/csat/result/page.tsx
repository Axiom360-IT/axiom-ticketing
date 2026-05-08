import Link from "next/link";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("tickets.csat");
  return { title: t("satisfiedTitle") };
}

type SearchParams = Promise<{
  status?: string;
  response?: string;
}>;

type ResultCopy = {
  title: string;
  body: string;
};

function pickCopy(
  status: string | undefined,
  response: string | undefined,
  t: (key: string) => string,
): ResultCopy {
  if (status === "invalid") {
    return { title: t("invalidTitle"), body: t("invalidBody") };
  }
  if (response === "satisfied") {
    return { title: t("satisfiedTitle"), body: t("satisfiedBody") };
  }
  if (response === "unsatisfied") {
    return { title: t("unsatisfiedTitle"), body: t("unsatisfiedBody") };
  }
  return { title: t("invalidTitle"), body: t("invalidBody") };
}

export default async function CsatResultPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { status, response } = await searchParams;
  const t = await getTranslations("tickets.csat");
  const copy = pickCopy(status, response, t);
  const alreadyResponded = status === "already";

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-16 px-4 flex items-start justify-center">
      <div className="max-w-md w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-sm p-8 text-center space-y-4">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          {copy.title}
        </h1>
        <p className="text-zinc-600 dark:text-zinc-300">{copy.body}</p>
        {alreadyResponded ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("alreadyResponded")}
          </p>
        ) : null}
        <div className="pt-2">
          <Link
            href="/portal/submit"
            className="text-sm font-medium text-blue-700 dark:text-blue-400 hover:underline"
          >
            {t("submitAnother")}
          </Link>
        </div>
      </div>
    </div>
  );
}
