"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  approvePendingParticipant,
  rejectPendingParticipant,
} from "@/app/actions/moderation";

/**
 * One address waiting to join a ticket's thread. There is no message body to
 * show, so this deliberately isn't HeldMessageCard — instead it surfaces what
 * the approver actually needs to decide: who proposed it, on which ticket, and
 * how well that ticket's organization is established. A guest request on a
 * ticket whose org was never verified is the least-evidenced case there is,
 * and says so.
 */
export type PendingParticipantView = {
  id: string;
  email: string;
  name: string | null;
  addedVia: string;
  requestedAt: string;
  ticketId: string;
  ticketNumber: string;
  ticketSubject: string;
  ticketCustomerEmail: string;
  orgMatchStatus: string;
  domainMatchesTicketOrg: boolean;
};

export function PendingParticipantCard({
  participant,
}: {
  participant: PendingParticipantView;
}) {
  const router = useRouter();
  const t = useTranslations("moderation.participants");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(approve: boolean) {
    setError(null);
    setWarning(null);
    startTransition(async () => {
      const res = approve
        ? await approvePendingParticipant(participant.id)
        : await rejectPendingParticipant(participant.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // A refresh drops this card off the queue, taking any message with it.
      // So when the decision stuck but the invitation email didn't send, hold
      // the card and say so — the next page load clears it either way.
      const w = "warning" in res ? res.warning : undefined;
      if (w) {
        setWarning(w);
        return;
      }
      router.refresh();
    });
  }

  const unverifiedOrg =
    participant.orgMatchStatus === "unverified" ||
    participant.orgMatchStatus === "none";

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {participant.name || participant.email}
            </p>
            {participant.name ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {participant.email}
              </p>
            ) : null}
          </div>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {participant.requestedAt}
          </span>
        </div>

        <dl className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
          <div className="flex gap-1.5">
            <dt className="font-medium">{t("ticketLabel")}</dt>
            <dd className="min-w-0 truncate">
              <Link
                href={`/admin/tickets/${participant.ticketId}`}
                className="font-mono text-blue-600 hover:underline dark:text-blue-400"
              >
                {participant.ticketNumber}
              </Link>{" "}
              {participant.ticketSubject}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="font-medium">{t("requestedByLabel")}</dt>
            <dd className="min-w-0 truncate">
              {participant.addedVia === "guest_request"
                ? t("viaGuest", { email: participant.ticketCustomerEmail })
                : t("viaInbound")}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="font-medium">{t("domainLabel")}</dt>
            <dd>
              {participant.domainMatchesTicketOrg
                ? t("domainMatches")
                : t("domainDiffers")}
            </dd>
          </div>
        </dl>

        {unverifiedOrg ? (
          <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
            {t("unverifiedWarning")}
          </p>
        ) : null}

        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {t("grantsAccess")}
        </p>

        {error ? (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}

        {warning ? (
          <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
            {warning}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button size="sm" onClick={() => decide(true)} disabled={pending}>
            {t("approve")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => decide(false)}
            disabled={pending}
          >
            {t("reject")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
