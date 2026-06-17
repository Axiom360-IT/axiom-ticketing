import { and, asc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/info-hint";
import { Separator } from "@/components/ui/separator";
import {
  AssignControl,
  type Technician,
} from "@/components/tickets/assign-control";
import { BillableControl } from "@/components/tickets/billable-control";
import { MergedTechnicians } from "@/components/tickets/merged-technicians";
import { TicketOrgControl } from "@/components/tickets/ticket-org-control";
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
import { MergeModal } from "@/components/tickets/merge-modal";
import { ReopenButton } from "@/components/tickets/reopen-button";
import { ReplyComposer } from "@/components/tickets/reply-composer";
import { ResolveModal } from "@/components/tickets/resolve-modal";
import { PriorityControl } from "@/components/tickets/priority-control";
import { StatusControl } from "@/components/tickets/status-control";
import { WorkLog } from "@/components/tickets/work-log";
import { TicketProcurementSection } from "@/components/procurement/ticket-section";
import { listProcurementForTicket } from "@/app/actions/procurement";
import { listWorkLogsForTicket } from "@/app/actions/work-logs";
import { listTicketCollaborators } from "@/app/actions/ticket-assignees";
import { listActiveOrganizations } from "@/app/actions/organizations";
import { listActiveParticipants } from "@/lib/tickets/participants";
import { approvedMessages } from "@/lib/messages/visibility";
import { getAttachmentLimits } from "@/lib/storage/limits";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { attachments } from "@/lib/db/schema/attachments";
import { users } from "@/lib/db/schema/auth";
import { messages } from "@/lib/db/schema/messages";
import { rolePermissions, roles, userRoles } from "@/lib/db/schema/rbac";
import { ticketAssignees } from "@/lib/db/schema/ticket-assignees";
import { tickets } from "@/lib/db/schema/tickets";
import { workLogs } from "@/lib/db/schema/work-logs";

const ORIGIN_KEYS: Record<string, "originWebForm" | "originEmail" | "originPortal"> = {
  web_form: "originWebForm",
  email: "originEmail",
  portal: "originPortal",
};

/** Human-readable completion time from open → close (Meeting-2, CR-15). */
function formatCompletionTime(fromMs: number, toMs: number): string {
  const totalMinutes = Math.max(0, Math.round((toMs - fromMs) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  const t = await getTranslations("tickets.detail");
  const tWorkLog = await getTranslations("tickets.workLog");
  const tBillable = await getTranslations("tickets.billable");
  const tOrgControl = await getTranslations("tickets.orgControl");
  const tQueue = await getTranslations("tickets.queue");
  const tCsat = await getTranslations("tickets.csat");
  const tEscalationReason = await getTranslations("tickets.escalationReason");
  const formatter = await getFormatter();

  const { id } = await params;

  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, id))
    .limit(1);
  if (!ticket) notFound();

  // Collaborators (so a strict-tech collaborator isn't 404'd here) and whether
  // the viewer has logged work on this ticket (grants read-only carry-over
  // access after the ticket is reassigned away from them).
  const [scopeCollaborators, viewerWorklog] = await Promise.all([
    db
      .select({ userId: ticketAssignees.userId })
      .from(ticketAssignees)
      .where(eq(ticketAssignees.ticketId, ticket.id)),
    db
      .select({ id: workLogs.id })
      .from(workLogs)
      .where(
        and(
          eq(workLogs.ticketId, ticket.id),
          eq(workLogs.technicianId, user.id),
        ),
      )
      .limit(1),
  ]);

  const ticketScope = {
    type: "ticket" as const,
    ticket: {
      id: ticket.id,
      assignedToId: ticket.assignedToId,
      customerId: ticket.customerId,
      assigneeIds: scopeCollaborators.map((c) => c.userId),
      viewerHasWorklog: viewerWorklog.length > 0,
    },
  };

  const canView = await can(user, "tickets.view", ticketScope, productionContext);
  if (!canView) notFound();

  const [
    canReply,
    canInternalNote,
    canResolve,
    canResolveSkipNote,
    canAssign,
    canEscalate,
    canDeescalate,
    canReopen,
    canDelete,
    canUpdate,
    canProcurementView,
    canProcurementCreate,
    canManageOrg,
    canMerge,
  ] = await Promise.all([
    can(user, "tickets.reply", ticketScope, productionContext),
    can(user, "tickets.internal_note", ticketScope, productionContext),
    can(user, "tickets.resolve", ticketScope, productionContext),
    can(user, "tickets.resolve_skip_note", ticketScope, productionContext),
    can(user, "tickets.assign", ticketScope, productionContext),
    can(user, "tickets.escalate", ticketScope, productionContext),
    can(user, "tickets.deescalate", ticketScope, productionContext),
    can(user, "tickets.reopen", ticketScope, productionContext),
    can(user, "tickets.delete", ticketScope, productionContext),
    can(user, "tickets.update", ticketScope, productionContext),
    can(user, "procurement.view", { type: "global" }, productionContext),
    can(user, "procurement.create", { type: "global" }, productionContext),
    can(user, "organizations.update", { type: "global" }, productionContext),
    can(user, "tickets.merge", ticketScope, productionContext),
  ]);

  const procurementRows = canProcurementView
    ? await listProcurementForTicket(ticket.id)
    : [];

  // Coordinators+ can set/change the ticket's organization right here (the
  // same link/dismiss used by the triage queue), so a dismissed or mis-matched
  // ticket isn't stuck. Only load the org list when they can act.
  const orgsForControl = canManageOrg ? await listActiveOrganizations() : [];

  const workLogEntries = await listWorkLogsForTicket(ticket.id);

  const attachmentLimits = await getAttachmentLimits();

  // If this ticket was merged into another, fetch the target's number
  // + id so the banner can deep-link there. Skipped when not merged.
  let mergedTarget: { id: string; ticketNumber: string } | null = null;
  if (ticket.duplicateOfId) {
    const [target] = await db
      .select({ id: tickets.id, ticketNumber: tickets.ticketNumber })
      .from(tickets)
      .where(eq(tickets.id, ticket.duplicateOfId))
      .limit(1);
    if (target) mergedTarget = target;
  }

  const messageRows = await db
    .select({
      id: messages.id,
      authorName: messages.authorName,
      authorEmail: messages.authorEmail,
      authorType: messages.authorType,
      body: messages.body,
      bodyFormat: messages.bodyFormat,
      channel: messages.channel,
      isInternalNote: messages.isInternalNote,
      isResolutionNote: messages.isResolutionNote,
      createdAt: messages.createdAt,
    })
    .from(messages)
    // Exclude held/rejected inbound replies — they live in the moderation
    // queue, not the thread (req 5.2). Internal notes still show to agents.
    .where(and(eq(messages.ticketId, ticket.id), approvedMessages()))
    .orderBy(asc(messages.createdAt));

  // Recognized external participants (same-org colleagues looped in by email)
  // — used to badge their replies in the thread (req 5.2).
  const ticketParticipantRows = await listActiveParticipants(ticket.id);
  const participantEmails = new Set(
    ticketParticipantRows.map((p) => p.email.toLowerCase()),
  );

  // Load attachments for the thread in a single query and group by message.
  const attachmentRows = await db
    .select({
      id: attachments.id,
      messageId: attachments.messageId,
      fileName: attachments.fileName,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
      scanStatus: attachments.scanStatus,
      uploadConfirmedAt: attachments.uploadConfirmedAt,
    })
    .from(attachments)
    .where(
      and(
        eq(attachments.ticketId, ticket.id),
        isNotNull(attachments.messageId),
        isNotNull(attachments.uploadConfirmedAt),
        ne(attachments.scanStatus, "quarantined"),
      ),
    );

  const attachmentsByMessage = new Map<string, ThreadMessage["attachments"]>();
  for (const a of attachmentRows) {
    if (!a.messageId) continue;
    const list = attachmentsByMessage.get(a.messageId) ?? [];
    list.push({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      isImage: a.mimeType.startsWith("image/"),
    });
    attachmentsByMessage.set(a.messageId, list);
  }

  const thread: ThreadMessage[] = messageRows.map((m) => ({
    ...m,
    authorType: m.authorType as ThreadMessage["authorType"],
    isParticipant: participantEmails.has(m.authorEmail.toLowerCase()),
    attachments: attachmentsByMessage.get(m.id) ?? [],
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

  // Merged-ticket co-assignees (req 4.4). A ticket carries a second technician
  // ONLY as a merge result; we always load them so BOTH techs are displayed,
  // and the Superadmin (tickets.merge) can remove either (req 4.5).
  const coAssignees = await listTicketCollaborators(ticket.id);

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

  const tActions = await getTranslations("tickets.actions");

  return (
    <div className="space-y-6 max-w-5xl">
      {mergedTarget ? (
        <div
          role="status"
          className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm"
        >
          <span className="font-medium text-amber-900 dark:text-amber-100">
            {tActions("mergedBannerLabel")}{" "}
          </span>
          <a
            href={`/admin/tickets/${mergedTarget.id}`}
            className="font-mono text-blue-700 dark:text-blue-400 hover:underline"
          >
            {mergedTarget.ticketNumber}
          </a>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
            {tActions("mergedBannerHint")}
          </p>
        </div>
      ) : null}
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-semibold sm:text-2xl">{ticket.subject}</h1>
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
        {ticket.closedAt ?? ticket.resolvedAt ? (
          <>
            <span>·</span>
            <span>
              {t("completedIn", {
                duration: formatCompletionTime(
                  ticket.createdAt.getTime(),
                  (ticket.closedAt ?? ticket.resolvedAt)!.getTime(),
                ),
              })}
            </span>
          </>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-6 min-w-0">
          {/* Work Log sits ABOVE the conversation (Meeting-2, CR-12) so it's
              the first thing a technician records against the ticket. */}
          <Card>
            <CardHeader>
              <CardTitle>{tWorkLog("title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <WorkLog
                ticketId={ticket.id}
                canLog={canUpdate}
                currentUserId={user.id}
                viewerIsAssigned={
                  ticket.assignedToId === user.id ||
                  coAssignees.some((c) => c.id === user.id)
                }
                entries={workLogEntries.map((e) => ({
                  id: e.id,
                  description: e.description,
                  minutes: e.minutes,
                  serviceType: e.serviceType,
                  createdAt: e.createdAt,
                  technicianId: e.technicianId,
                  technicianName: e.technicianName,
                }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("conversationTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Long threads scroll internally instead of stretching the
                  whole page; -mr-2/pr-2 keeps the scrollbar off the content. */}
              <div className="max-h-[34rem] overflow-y-auto -mr-2 pr-2">
                <MessageThread messages={thread} />
              </div>
            </CardContent>
          </Card>

          {/* Reply to Customer + Internal Notes are now distinct sections
              (Meeting-2, CR-08/09) so a technician can't confuse the two. */}
          {canReply && !isClosedOrResolved ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("replyToCustomerTitle")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ReplyComposer
                  ticketId={ticket.id}
                  mode="customer"
                  maxFiles={attachmentLimits.maxFilesPerMessage}
                  maxFileBytes={attachmentLimits.maxFileBytes}
                />
              </CardContent>
            </Card>
          ) : null}

          {canInternalNote && !isClosedOrResolved ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("internalNotesTitle")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ReplyComposer
                  ticketId={ticket.id}
                  mode="internal"
                  canInternalNote
                  maxFiles={attachmentLimits.maxFilesPerMessage}
                  maxFileBytes={attachmentLimits.maxFileBytes}
                />
              </CardContent>
            </Card>
          ) : null}

          {canProcurementView ? (
            <TicketProcurementSection
              ticketId={ticket.id}
              requests={procurementRows.map((r) => ({
                id: r.id,
                type: r.type,
                itemName: r.itemName,
                quantity: r.quantity,
                status: r.status,
                createdAt: r.createdAt,
              }))}
              canCreate={canProcurementCreate}
            />
          ) : null}

          {(canUpdate || canResolve || canEscalate || canDeescalate || canDelete) &&
          !isClosedOrResolved ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("actionsTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {canUpdate ? (
                  <StatusControl ticketId={ticket.id} current={ticket.status} />
                ) : null}
                {canUpdate ? (
                  <PriorityControl
                    ticketId={ticket.id}
                    current={ticket.priority}
                  />
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {canResolve ? (
                    <ResolveModal
                      ticketId={ticket.id}
                      canSkipNote={canResolveSkipNote}
                    />
                  ) : null}
                  {(canEscalate && !ticket.isEscalated) ||
                  (canDeescalate && ticket.isEscalated) ? (
                    <EscalateModal
                      ticketId={ticket.id}
                      isEscalated={ticket.isEscalated}
                      canDeescalate={canDeescalate}
                    />
                  ) : null}
                  {/* Merge gate (req §4 — Superadmin): caller holds
                      tickets.merge AND this ticket isn't already a duplicate.
                      Once merged a ticket is closed-as-duplicate, so merging
                      again doesn't make sense. */}
                  {canMerge && !ticket.duplicateOfId ? (
                    <MergeModal
                      ticketId={ticket.id}
                      sourceTicketNumber={ticket.ticketNumber}
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

        <aside className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("customerTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <div>{ticket.customerName}</div>
              <div className="text-zinc-500 dark:text-zinc-400">
                {ticket.customerEmail}
              </div>
              {ticket.customerCompany ? (
                <div className="pt-1 text-zinc-500 dark:text-zinc-400">
                  {t("companyLabel")}:{" "}
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {ticket.customerCompany}
                  </span>
                </div>
              ) : null}
              {ticket.orgMatchStatus === "unverified" ? (
                <p className="mt-1 inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                  {t("orgUnverified")}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {canManageOrg ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-1.5">
                  {tOrgControl("title")}
                  <InfoHint label={tOrgControl("help")} />
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <TicketOrgControl
                  ticketId={ticket.id}
                  currentOrganizationId={ticket.organizationId}
                  organizations={orgsForControl.map((o) => ({
                    id: o.id,
                    name: o.name,
                  }))}
                />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-1.5">
                {t("assigneeTitle")}
                <InfoHint label={t("assigneeHelp")} />
              </CardTitle>
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

              {coAssignees.length > 0 ? (
                <MergedTechnicians
                  ticketId={ticket.id}
                  primary={
                    ticket.assignedToId && assigneeName
                      ? { id: ticket.assignedToId, name: assigneeName }
                      : null
                  }
                  coAssignees={coAssignees.map((c) => ({
                    id: c.id,
                    name: c.name,
                  }))}
                  canManage={canMerge}
                />
              ) : null}
            </CardContent>
          </Card>

          {/* Billing categorization (Meeting-2, CR-16/17/18) — set per ticket
              by anyone who can update it. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-1.5">
                {tBillable("title")}
                <InfoHint label={tBillable("help")} />
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {canUpdate ? (
                <BillableControl
                  ticketId={ticket.id}
                  current={ticket.billable}
                />
              ) : (
                <div>
                  {ticket.billable ? (
                    tBillable(ticket.billable)
                  ) : (
                    <span className="text-zinc-400">{tBillable("unset")}</span>
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
                <p className="font-medium">
                  {tEscalationReason(
                    ticket.escalationReason as
                      | "beyond_scope"
                      | "requires_access"
                      | "critical_impact"
                      | "vendor_involvement"
                      | "other",
                  )}
                </p>
                {ticket.escalationNote ? (
                  <p className="whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">
                    {ticket.escalationNote}
                  </p>
                ) : null}
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
