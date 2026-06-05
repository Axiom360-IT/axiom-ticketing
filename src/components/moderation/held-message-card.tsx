"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  approveAndTrustHeldMessage,
  approveHeldMessage,
  rejectHeldMessage,
} from "@/app/actions/moderation";

type HeldMessage = {
  id: string;
  ticketId: string;
  ticketNumber: string;
  ticketSubject: string;
  authorName: string;
  authorEmail: string;
  body: string;
  receivedAt: string;
};

export function HeldMessageCard({ message }: { message: HeldMessage }) {
  const router = useRouter();
  const t = useTranslations("moderation");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(kind: "approve" | "trust" | "reject") {
    setError(null);
    startTransition(async () => {
      const res =
        kind === "trust"
          ? await approveAndTrustHeldMessage(message.id)
          : kind === "approve"
            ? await approveHeldMessage(message.id)
            : await rejectHeldMessage(message.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="min-w-0">
            <span className="text-sm font-medium">{message.authorName}</span>{" "}
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              &lt;{message.authorEmail}&gt;
            </span>
          </div>
          <span className="text-xs text-zinc-400">{message.receivedAt}</span>
        </div>

        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {t("onTicket")}{" "}
          <Link
            href={`/admin/tickets/${message.ticketId}`}
            className="font-mono text-blue-600 hover:underline dark:text-blue-400"
          >
            {message.ticketNumber}
          </Link>{" "}
          — {message.ticketSubject}
        </p>

        <p className="whitespace-pre-wrap break-words rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          {message.body}
        </p>

        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t("heldNote")}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => decide("trust")} disabled={pending}>
            {t("approveTrust")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => decide("approve")}
            disabled={pending}
          >
            {t("approveOnce")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => decide("reject")}
            disabled={pending}
          >
            {t("reject")}
          </Button>
          {error ? (
            <span role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-zinc-400">{t("trustHint")}</p>
      </CardContent>
    </Card>
  );
}
