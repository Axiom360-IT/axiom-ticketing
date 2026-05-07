import Link from "next/link";

export const metadata = {
  title: "Thanks for the feedback — Axiom360",
};

type SearchParams = Promise<{
  status?: string;
  response?: string;
}>;

const COPY = {
  satisfied: {
    title: "Glad it's fixed",
    body:
      "Thanks for confirming — we've closed the ticket. If anything comes back, just open a new one and we'll pick it up.",
  },
  unsatisfied: {
    title: "Sorry that didn't do it",
    body:
      "We've reopened the ticket and a technician will follow up. Watch your inbox for the next update.",
  },
  invalid: {
    title: "We couldn't confirm that link",
    body:
      "The CSAT link in your email looks expired or invalid. If you still need to give feedback, reply to the resolution email and we'll capture it manually.",
  },
} as const;

function pickCopy(status: string | undefined, response: string | undefined) {
  if (status === "invalid") return COPY.invalid;
  if (response === "satisfied") return COPY.satisfied;
  if (response === "unsatisfied") return COPY.unsatisfied;
  return COPY.invalid;
}

export default async function CsatResultPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { status, response } = await searchParams;
  const copy = pickCopy(status, response);
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
            We already had your answer on file — nothing else changed.
          </p>
        ) : null}
        <div className="pt-2">
          <Link
            href="/portal/submit"
            className="text-sm font-medium text-blue-700 dark:text-blue-400 hover:underline"
          >
            Submit another ticket
          </Link>
        </div>
      </div>
    </div>
  );
}
