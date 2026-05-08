import { asc, eq, inArray } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  AssignControl,
  type Technician,
} from "@/components/tickets/assign-control";
import {
  CategoryBadge,
  EscalatedBadge,
  PriorityBadge,
  StatusBadge,
} from "@/components/tickets/badges";
import { EscalateModal } from "@/components/tickets/escalate-modal";
import {
  MessageThread,
  type ThreadMessage,
} from "@/components/tickets/message-thread";
import { ReopenButton } from "@/components/tickets/reopen-button";
import { ReplyComposer } from "@/components/tickets/reply-composer";
import { ResolveModal } from "@/components/tickets/resolve-modal";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { messages } from "@/lib/db/schema/messages";
import { rolePermissions, roles, userRoles } from "@/lib/db/schema/rbac";
import { tickets } from "@/lib/db/schema/tickets";

export const dynamic = "force-dynamic";

const ORIGIN_KEYS: Record<string, "originWebForm" | "originEmail" | "originPortal"> = {
  web_form: "originWebForm",
  email: "originEmail",
  portal: "originPortal",
};

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  const t = await getTranslations("tickets.detail");
  const tQueue = await getTranslations("tickets.queue");
  const tCsat = await getTranslations("tickets.csat");
  const formatter = await getFormatter();

  const { id } = await params;

  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, id))
    .limit(1);
  if (!ticket) notFound();

  const ticketScope = {
    type: "ticket" as const,
    ticket: {
      id: ticket.id,
      assignedToId: ticket.assignedToId,
      customerId: ticket.customerId,
    },
  };

  const canView = await can(user, "tickets.view", ticketScope, productionContext);
  if (!canView) notFound();

  const [
    canReply,
    canInternalNote,
    canResolve,
    canAssign,
    canEscalate,
    canDeescalate,
    canReopen,
  ] = await Promise.all([
    can(user, "tickets.reply", ticketScope, productionContext),
    can(user, "tickets.internal_note", ticketScope, productionContext),
    can(user, "tickets.resolve", ticketScope, productionContext),
    can(user, "tickets.assign", ticketScope, productionContext),
    can(user, "tickets.escalate", ticketScope, productionContext),
    can(user, "tickets.deescalate", ticketScope, productionContext),
    can(user, "tickets.reopen", ticketScope, productionContext),
  ]);

  const messageRows = await db
    .select({
      id: messages.id,
      authorName: messages.authorName,
      authorEmail: messages.authorEmail,
      authorType: messages.authorType,
      body: messages.body,
      channel: messages.channel,
      isInternalNote: messages.isInternalNote,
      isResolutionNote: messages.isResolutionNote,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.ticketId, ticket.id))
    .orderBy(asc(messages.createdAt));

  const thread: ThreadMessage[] = messageRows.map((m) => ({
    ...m,
    authorType: m.authorType as ThreadMessage["authorType"],
  }));

  // Resolve assignee name (if any) and load technicians for the assign dropdown
  let assigneeName: string | null = null;
  if (ticket.assignedToId) {
    const [a] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, ticket.assignedToId))
      .limit(1);
    assigneeName = a?.name ?? null;
  }

  let technicians: Technician[] = [];
  if (canAssign) {
    // Anyone holding tickets.update — that covers Technician + Coordinator + IT Director
    // and gives Coordinators flexibility to assign to themselves or peers.
    const techRoleRows = await db
      .selectDistinct({ roleId: rolePermissions.roleId })
      .from(rolePermissions)
      .where(eq(rolePermissions.permission, "tickets.update"));
    const techRoleIds = techRoleRows.map((r) => r.roleId);

    if (techRoleIds.length > 0) {
      const techRows = await db
        .selectDistinct({
          id: users.id,
          name: users.name,
          email: users.email,
        })
        .from(users)
        .innerJoin(userRoles, eq(userRoles.userId, users.id))
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(inArray(roles.id, techRoleIds));

      technicians = techRows
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  const isClosedOrResolved =
    ticket.status === "resolved" || ticket.status === "closed";

  const originLabel = t("originLabel", {
    origin: t(ORIGIN_KEYS[ticket.origin] ?? "originWebForm"),
  });

  const streamLabel =
    ticket.stream === "internal" ? t("streamInternal") : t("streamExternal");

  let csatLine: string | null = null;
  if (ticket.csatResponse === "satisfied" || ticket.csatResponse === "unsatisfied") {
    const responseLabel = tCsat(
      ticket.csatResponse === "satisfied"
        ? "responseSatisfied"
        : "responseUnsatisfied",
    );
    csatLine = ticket.csatRespondedAt
      ? t("csatLabelWithDate", {
          response: responseLabel,
          date: formatter.dateTime(ticket.csatRespondedAt, {
            dateStyle: "medium",
            timeStyle: "short",
          }),
        })
      : t("csatLabel", { response: responseLabel });
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold">{ticket.subject}</h1>
        {ticket.isEscalated ? <EscalatedBadge /> : null}
      </div>
      <div className="flex items-center gap-2 flex-wrap text-sm text-zinc-500 dark:text-zinc-400">
        <span className="font-mono">{ticket.ticketNumber}</span>
        <span>·</span>
        <StatusBadge status={ticket.status} />
        <PriorityBadge priority={ticket.priority} />
        <CategoryBadge category={ticket.category} />
        <span>·</span>
        <span>
          {t("openedBy", {
            date: formatter.dateTime(ticket.createdAt, { dateStyle: "medium" }),
            customerName: ticket.customerName,
          })}
        </span>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("conversationTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <MessageThread messages={thread} />
            </CardContent>
          </Card>

          {(canReply || canInternalNote) && !isClosedOrResolved ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("replyTitle")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ReplyComposer
                  ticketId={ticket.id}
                  canInternalNote={canInternalNote}
                />
              </CardContent>
            </Card>
          ) : null}

          {(canResolve || canEscalate || canDeescalate) &&
          !isClosedOrResolved ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("actionsTitle")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {canResolve ? <ResolveModal ticketId={ticket.id} /> : null}
                  {(canEscalate && !ticket.isEscalated) ||
                  (canDeescalate && ticket.isEscalated) ? (
                    <EscalateModal
                      ticketId={ticket.id}
                      isEscalated={ticket.isEscalated}
                      canDeescalate={canDeescalate}
                    />
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {canReopen && isClosedOrResolved ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("actionsTitle")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ReopenButton ticketId={ticket.id} />
                {csatLine ? (
                  <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                    {csatLine}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("customerTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <div>{ticket.customerName}</div>
              <div className="text-zinc-500 dark:text-zinc-400">
                {ticket.customerEmail}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("assigneeTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              {canAssign ? (
                <AssignControl
                  ticketId={ticket.id}
                  currentAssigneeId={ticket.assignedToId}
                  technicians={technicians}
                />
              ) : (
                <div>
                  {assigneeName ?? (
                    <span className="text-zinc-400">
                      {tQueue("unassigned")}
                    </span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {ticket.isEscalated && ticket.escalationReason ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  {t("escalationTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <p className="whitespace-pre-wrap">
                  {ticket.escalationReason}
                </p>
                {ticket.escalatedAt ? (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {formatter.dateTime(ticket.escalatedAt, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("streamTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <span>{streamLabel}</span>
              <Separator className="my-2" />
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {originLabel}
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
