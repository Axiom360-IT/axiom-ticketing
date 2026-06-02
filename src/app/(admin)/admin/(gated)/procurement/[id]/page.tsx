import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getFormatter, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ProcurementDecisionButtons } from "@/components/procurement/decision-buttons";
import { ProcurementStatusBadge } from "@/components/procurement/status-badge";
import { getProcurementDetail } from "@/app/actions/procurement";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema/tickets";

export default async function ProcurementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  const { id } = await params;
  const r = await getProcurementDetail(id);
  if (!r) notFound();

  const [ticket] = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
    })
    .from(tickets)
    .where(eq(tickets.id, r.ticketId))
    .limit(1);

  const canManage = await can(
    user,
    "procurement.manage",
    { type: "global" },
    productionContext,
  );

  const t = await getTranslations("procurement.detail");
  const tList = await getTranslations("procurement.list");
  const tType = await getTranslations("procurement.type");
  const formatter = await getFormatter();

  return (
    <div className="space-y-6 max-w-3xl">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{r.itemName}</h1>
        <div className="flex items-center gap-2 flex-wrap text-sm text-zinc-500 dark:text-zinc-400">
          <ProcurementStatusBadge status={r.status} />
          <span>·</span>
          <span>{tType(r.type as "hardware" | "software" | "other")}</span>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("summaryTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {ticket ? (
            <Row
              label={t("ticketLabel")}
              value={
                <Link
                  href={`/admin/tickets/${ticket.id}`}
                  className="font-mono text-blue-600 hover:underline dark:text-blue-400"
                >
                  {tList("ticketLink", {
                    number: ticket.ticketNumber,
                    subject: ticket.subject,
                  })}
                </Link>
              }
            />
          ) : null}
          <Row label={t("requesterLabel")} value={r.requestedByEmail} />
          {r.vendor ? (
            <Row label={t("vendorLabel")} value={r.vendor} />
          ) : null}
          {r.estimatedCost ? (
            <Row label={t("costLabel")} value={r.estimatedCost} />
          ) : null}
          {r.dateNeededBy ? (
            <Row label={t("neededByLabel")} value={r.dateNeededBy} />
          ) : null}
          <Row
            label={t("submittedLabel")}
            value={formatter.dateTime(r.createdAt, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          />
          <Separator className="my-2" />
          <p className="whitespace-pre-wrap">{r.justification}</p>
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("actionsTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ProcurementDecisionButtons
              requestId={r.id}
              status={r.status}
              canManage={canManage}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="text-zinc-500 dark:text-zinc-400 w-32 shrink-0">
        {label}
      </span>
      <span className="flex-1">{value}</span>
    </div>
  );
}
