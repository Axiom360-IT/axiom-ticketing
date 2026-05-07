import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tickets</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {rows.length} {rows.length === 1 ? "ticket" : "tickets"}
            {search ? ` matching "${search}"` : ""}
          </p>
        </div>
        {canCreate ? (
          <Button render={<Link href="/admin/tickets/new" />}>
            Create on behalf
          </Button>
        ) : null}
      </div>

      <form className="flex gap-2" action="/admin/tickets" method="get">
        <Input
          name="q"
          defaultValue={search}
          placeholder="Search by ticket #, subject, or customer email"
          className="max-w-md"
        />
      </form>

      <Card className="p-0">
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {search
                  ? "No tickets match your search."
                  : "No tickets yet. They'll appear here as customers submit them."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Ticket</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Assignee</TableHead>
                  <TableHead className="pr-4">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="px-4 font-mono text-xs">
                      <Link
                        href={`/admin/tickets/${t.id}`}
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {t.ticketNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">
                      <div className="flex items-center gap-2">
                        {t.isEscalated ? <EscalatedBadge /> : null}
                        <span>{t.subject}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={t.status} />
                    </TableCell>
                    <TableCell>
                      <PriorityBadge priority={t.priority} />
                    </TableCell>
                    <TableCell className="text-sm">
                      <div>{t.customerName}</div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {t.customerEmail}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {t.assignedToName ?? (
                        <span className="text-zinc-400">Unassigned</span>
                      )}
                    </TableCell>
                    <TableCell className="pr-4 text-xs text-zinc-500 dark:text-zinc-400">
                      {formatRelative(t.updatedAt)}
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

function formatRelative(d: Date): string {
  const ms = Date.now() - d.getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}
