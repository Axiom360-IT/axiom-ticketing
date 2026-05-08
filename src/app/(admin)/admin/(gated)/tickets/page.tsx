import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { getFormatter, getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  EscalatedBadge,
  PriorityBadge,
  StatusBadge,
} from "@/components/tickets/badges";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { ticketsVisibilityCondition } from "@/lib/auth/scope";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { tickets } from "@/lib/db/schema/tickets";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ q?: string }>;

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  const t = await getTranslations("tickets.queue");
  const formatter = await getFormatter();

  const { q } = await searchParams;
  const search = q?.trim() ?? "";

  const canCreate = await can(
    user,
    "tickets.create",
    { type: "global" },
    productionContext,
  );

  const visibility = ticketsVisibilityCondition(user);
  const searchClause: SQL | undefined = search
    ? or(
        ilike(tickets.ticketNumber, `%${search}%`),
        ilike(tickets.subject, `%${search}%`),
        ilike(tickets.customerEmail, `%${search}%`),
        ilike(tickets.customerName, `%${search}%`),
      )
    : undefined;

  const where =
    visibility && searchClause
      ? and(visibility, searchClause)
      : (visibility ?? searchClause);

  const rows = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      status: tickets.status,
      priority: tickets.priority,
      isEscalated: tickets.isEscalated,
      customerName: tickets.customerName,
      customerEmail: tickets.customerEmail,
      assignedToId: tickets.assignedToId,
      assignedToName: users.name,
      createdAt: tickets.createdAt,
      updatedAt: tickets.updatedAt,
    })
    .from(tickets)
    .leftJoin(users, eq(users.id, tickets.assignedToId))
    .where(where)
    .orderBy(desc(tickets.createdAt))
    .limit(100);

  const countLine = search
    ? t("countMatching", { count: rows.length, query: search })
    : t("count", { count: rows.length });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{countLine}</p>
        </div>
        {canCreate ? (
          <Button render={<Link href="/admin/tickets/new" />}>
            {t("createOnBehalf")}
          </Button>
        ) : null}
      </div>

      <form className="flex gap-2" action="/admin/tickets" method="get">
        <Input
          name="q"
          defaultValue={search}
          placeholder={t("search")}
          className="max-w-md"
        />
      </form>

      <Card className="p-0">
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {search ? t("emptyMatching") : t("empty")}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">{t("columns.ticket")}</TableHead>
                  <TableHead>{t("columns.subject")}</TableHead>
                  <TableHead>{t("columns.status")}</TableHead>
                  <TableHead>{t("columns.priority")}</TableHead>
                  <TableHead>{t("columns.customer")}</TableHead>
                  <TableHead>{t("columns.assignee")}</TableHead>
                  <TableHead className="pr-4">{t("columns.updated")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="px-4 font-mono text-xs">
                      <Link
                        href={`/admin/tickets/${row.id}`}
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {row.ticketNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">
                      <div className="flex items-center gap-2">
                        {row.isEscalated ? <EscalatedBadge /> : null}
                        <span>{row.subject}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>
                      <PriorityBadge priority={row.priority} />
                    </TableCell>
                    <TableCell className="text-sm">
                      <div>{row.customerName}</div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {row.customerEmail}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.assignedToName ?? (
                        <span className="text-zinc-400">
                          {t("unassigned")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="pr-4 text-xs text-zinc-500 dark:text-zinc-400">
                      {formatRelative(row.updatedAt, t, formatter)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type RelativeT = Awaited<ReturnType<typeof getTranslations<"tickets.queue">>>;
type Formatter = Awaited<ReturnType<typeof getFormatter>>;

function formatRelative(d: Date, t: RelativeT, formatter: Formatter): string {
  const ms = Date.now() - d.getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return t("relativeTime.justNow");
  if (minutes < 60) return t("relativeTime.minutes", { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("relativeTime.hours", { hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("relativeTime.days", { days });
  return formatter.dateTime(d, { dateStyle: "medium" });
}
