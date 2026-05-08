"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProcurementStatusBadge } from "@/components/procurement/status-badge";
import { ProcurementRequestForm } from "@/components/procurement/request-form";

export type TicketProcurementRow = {
  id: string;
  type: string;
  itemName: string;
  quantity: number;
  urgency: string;
  status: string;
  createdAt: Date;
};

type Props = {
  ticketId: string;
  requests: TicketProcurementRow[];
  canCreate: boolean;
};

export function TicketProcurementSection({
  ticketId,
  requests,
  canCreate,
}: Props) {
  const t = useTranslations("procurement.section");
  const tType = useTranslations("procurement.type");
  const tUrgency = useTranslations("procurement.urgency");
  const [creating, setCreating] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3">
        <CardTitle className="flex-1">{t("title")}</CardTitle>
        {canCreate && !creating ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCreating(true)}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {t("addButton")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {creating ? (
          <ProcurementRequestForm
            ticketId={ticketId}
            onCancel={() => setCreating(false)}
          />
        ) : null}

        {requests.length === 0 && !creating ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("empty")}
          </p>
        ) : null}

        {requests.length > 0 ? (
          <ul className="space-y-2">
            {requests.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-800"
              >
                <Link
                  href={`/admin/procurement/${r.id}`}
                  className="flex-1 text-sm hover:underline"
                >
                  <span className="font-medium">{r.itemName}</span>
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {" — "}
                    {r.quantity} ·{" "}
                    {tType(r.type as "hardware" | "software")} ·{" "}
                    {tUrgency(r.urgency as "low" | "medium" | "high")}
                  </span>
                </Link>
                <ProcurementStatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
