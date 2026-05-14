"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RowActionIcons } from "@/components/ui/row-actions";
import { ProcurementStatusBadge } from "@/components/procurement/status-badge";

export type ProcurementRowSummary = {
  id: string;
  itemName: string;
  quantity: number;
  type: string;
  urgency: string;
  status: string;
  estimatedCost: string | null;
  requestedByEmail: string | null;
  ticketId: string;
  ticketNumber: string | null;
  createdAt: Date;
};

type Props = {
  request: ProcurementRowSummary;
};

export function ProcurementRowActions({ request }: Props) {
  const t = useTranslations("common");
  const tDialog = useTranslations("procurement.rowActions");
  const tList = useTranslations("procurement.list");
  const tType = useTranslations("procurement.type");
  const tUrgency = useTranslations("procurement.urgency");
  const formatter = useFormatter();

  const [viewOpen, setViewOpen] = useState(false);

  return (
    <>
      <RowActionIcons
        ariaLabelPrefix={request.itemName}
        view={() => setViewOpen(true)}
      />

      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{request.itemName}</DialogTitle>
            <DialogDescription className="text-foreground text-sm">
              {tList("qty", { count: request.quantity })}
            </DialogDescription>
          </DialogHeader>

          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-zinc-500 dark:text-zinc-400">
              {tList("columns.status")}
            </dt>
            <dd>
              <ProcurementStatusBadge status={request.status} />
            </dd>
            <dt className="text-zinc-500 dark:text-zinc-400">
              {tList("columns.type")}
            </dt>
            <dd>{tType(request.type as "hardware" | "software")}</dd>
            <dt className="text-zinc-500 dark:text-zinc-400">
              {tList("columns.urgency")}
            </dt>
            <dd>{tUrgency(request.urgency as "low" | "medium" | "high")}</dd>
            {request.estimatedCost ? (
              <>
                <dt className="text-zinc-500 dark:text-zinc-400">
                  {tList("columns.cost")}
                </dt>
                <dd>{request.estimatedCost}</dd>
              </>
            ) : null}
            <dt className="text-zinc-500 dark:text-zinc-400">
              {tList("columns.requester")}
            </dt>
            <dd className="text-zinc-600 dark:text-zinc-300">
              {request.requestedByEmail ?? "—"}
            </dd>
            <dt className="text-zinc-500 dark:text-zinc-400">
              {tList("columns.ticket")}
            </dt>
            <dd>
              {request.ticketNumber ? (
                <Link
                  href={`/admin/tickets/${request.ticketId}`}
                  className="font-mono text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {request.ticketNumber}
                </Link>
              ) : (
                "—"
              )}
            </dd>
            <dt className="text-zinc-500 dark:text-zinc-400">
              {tList("columns.createdAt")}
            </dt>
            <dd className="text-zinc-600 dark:text-zinc-300">
              {formatter.dateTime(request.createdAt, { dateStyle: "medium" })}
            </dd>
          </dl>

          <DialogFooter>
            <Button variant="outline" onClick={() => setViewOpen(false)}>
              {t("close")}
            </Button>
            <Button
              nativeButton={false}
              render={<Link href={`/admin/procurement/${request.id}`} />}
            >
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              {tDialog("openFullRequest")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
