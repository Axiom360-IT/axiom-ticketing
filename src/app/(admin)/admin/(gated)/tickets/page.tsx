import Link from "next/link";
import { redirect } from "next/navigation";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { getFormatter, getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ExportMenu } from "@/components/shared/export-menu";
import {
  StickyActionsCell,
  StickyActionsHead,
} from "@/components/ui/row-actions";
import {
  Pagination,
  pageWindow,
  parsePage,
  parsePageSize,
  reservedTableHeight,
  takePage,
} from "@/components/ui/pagination";
import {
  BillingBadge,
  CategoryBadge,
  EscalatedBadge,
  PriorityBadge,
  StatusBadge,
} from "@/components/tickets/badges";
import { TicketFilters } from "@/components/tickets/ticket-filters";
import { ReassignedNotice } from "@/components/tickets/reassigned-notice";
import { UrlSearchInput } from "@/components/ui/url-search-input";
import { TicketRowActions } from "@/components/tickets/ticket-row-actions";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { ticketsVisibilityCondition } from "@/lib/auth/scope";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { organizations } from "@/lib/db/schema/organizations";
import { tickets } from "@/lib/db/schema/tickets";
import { listAssignableTechnicians } from "@/lib/tickets/load";
import { BILLING_FILTER_VALUES } from "@/lib/tickets/billing-status";
import { billingFilterCondition } from "@/lib/tickets/ticket-filter-conditions";
import { cn } from "@/lib/utils";

// Filter query string contract:
//   ?q=text                            free-text search
//   &status=open,in_progress           CSV multi-select
//   &priority=high,critical            CSV multi-select
//   &category=hardware,network         CSV multi-select
//   &assignee=<uuid>|unassigned        single-select
//   &escalated=1                       presence = true
//   &from=YYYY-MM-DD                   created on/after this date
//   &to=YYYY-MM-DD                     created on/before this date
type SearchParams = Promise<{
  q?: string;
  /** Tab scope: active (default, hides closed) | closed | all. */
  view?: string;
  status?: string;
  priority?: string;
  category?: string;
  stream?: string;
  assignee?: string;
  escalated?: string;
  from?: string;
  to?: string;
  /** CSV multi-select of billing states (see BILLING_FILTER_VALUES). */
  billing?: string;
  /** Organization id — single-select. */
  org?: string;
  /** Customer email — single-select (from the auto-populated customer list). */
  customer?: string;
  page?: string;
  pageSize?: string;
  /** Set after a reassign that cost the viewer access — shows a confirmation. */
  reassigned?: string;
}>;

const TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
const TICKET_PRIORITIES = ["low", "medium", "high", "critical"] as const;
const TICKET_CATEGORIES = [
  "hardware",
  "software",
  "network",
  "access",
  "other",
] as const;
const TICKET_STREAMS = ["internal", "external"] as const;

/** Split a CSV query-string value, drop empties, and intersect with the
 * allowed set so a junk URL parameter can't poison a `WHERE col IN (...)`
 * clause. Returns undefined when no valid values remain (so the caller
 * can skip emitting the clause entirely). */
function parseEnumCsv<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
): T[] | undefined {
  if (!raw) return undefined;
  const allow = new Set<string>(allowed);
  const picked = raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => allow.has(v)) as T[];
  return picked.length > 0 ? picked : undefined;
}

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  const t = await getTranslations("tickets.queue");
  const tCommon = await getTranslations("common");
  const tFilters = await getTranslations("tickets.filters");
  const formatter = await getFormatter();

  const sp = await searchParams;
  const search = sp.q?.trim() ?? "";
  // Tab scope. "active" (default) hides closed; "closed" shows only closed;
  // "all" imposes no status scope. An explicit status filter refines within it.
  const view: "active" | "closed" | "all" =
    sp.view === "closed" ? "closed" : sp.view === "all" ? "all" : "active";
  const filterStatus = parseEnumCsv(sp.status, TICKET_STATUSES);
  const filterPriority = parseEnumCsv(sp.priority, TICKET_PRIORITIES);
  const filterCategory = parseEnumCsv(sp.category, TICKET_CATEGORIES);
  const filterStream = parseEnumCsv(sp.stream, TICKET_STREAMS);
  const filterAssignee = sp.assignee?.trim() || undefined;
  const filterEscalated = sp.escalated === "1";
  const filterFrom = sp.from?.trim() || undefined;
  const filterTo = sp.to?.trim() || undefined;
  const filterBilling = parseEnumCsv(sp.billing, BILLING_FILTER_VALUES);
  const filterOrg = sp.org?.trim() || undefined;
  const filterCustomer = sp.customer?.trim() || undefined;
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.pageSize);
  const { limit, offset } = pageWindow(page, pageSize);

  const [canCreate, canDeleteGlobal, canExport] = await Promise.all([
    can(user, "tickets.create", { type: "global" }, productionContext),
    can(user, "tickets.delete", { type: "global" }, productionContext),
    can(user, "tickets.export", { type: "global" }, productionContext),
  ]);
  // UI-affordance gate for the assignee filter + the per-row Assign action. Use
  // the RAW permission grant — NOT can(..., { type: "global" }): the
  // `tickets.assign` branch in can() mandates a ticket target, so a global
  // check can never return true. That's why the assignee filter listed no
  // technicians and the row Assign control never appeared. Per-ticket
  // authorization is still enforced server-side in `assignTicket`.
  const canAssignGlobal = user.permissions.has("tickets.assign");

  // Technicians power both the inline assignee filter dropdown and the per-row
  // Assign action — fetch once for anyone who can assign.
  const technicians = canAssignGlobal ? await listAssignableTechnicians() : [];

  // Build the WHERE clause as an array of conditions; AND them together
  // so each filter is independent and trivially extensible.
  const conditions: SQL[] = [ticketsVisibilityCondition(user)];

  if (search) {
    const orClause = or(
      ilike(tickets.ticketNumber, `%${search}%`),
      ilike(tickets.subject, `%${search}%`),
      ilike(tickets.customerEmail, `%${search}%`),
      ilike(tickets.customerName, `%${search}%`),
    );
    if (orClause) conditions.push(orClause);
  }
  // View tab sets the base status scope; an explicit status filter refines
  // within it (an out-of-scope status — e.g. "closed" while on Active — is
  // simply ignored rather than escaping the tab).
  if (view === "closed") {
    conditions.push(eq(tickets.status, "closed"));
  } else if (view === "active") {
    conditions.push(ne(tickets.status, "closed"));
  }
  if (filterStatus) {
    const scoped =
      view === "closed"
        ? filterStatus.filter((s) => s === "closed")
        : view === "active"
          ? filterStatus.filter((s) => s !== "closed")
          : filterStatus;
    if (scoped.length > 0) conditions.push(inArray(tickets.status, scoped));
  }
  if (filterPriority) conditions.push(inArray(tickets.priority, filterPriority));
  if (filterCategory) conditions.push(inArray(tickets.category, filterCategory));
  if (filterStream) conditions.push(inArray(tickets.stream, filterStream));
  if (filterAssignee === "unassigned") {
    conditions.push(isNull(tickets.assignedToId));
  } else if (filterAssignee) {
    conditions.push(eq(tickets.assignedToId, filterAssignee));
  }
  if (filterEscalated) conditions.push(eq(tickets.isEscalated, true));
  if (filterFrom) {
    const fromDate = new Date(`${filterFrom}T00:00:00.000Z`);
    if (!Number.isNaN(fromDate.getTime())) {
      conditions.push(gte(tickets.createdAt, fromDate));
    }
  }
  if (filterTo) {
    // End-of-day inclusive — UTC midnight of the next day.
    const toDate = new Date(`${filterTo}T23:59:59.999Z`);
    if (!Number.isNaN(toDate.getTime())) {
      conditions.push(lte(tickets.createdAt, toDate));
    }
  }
  if (filterBilling) {
    const billingCond = billingFilterCondition(filterBilling);
    if (billingCond) conditions.push(billingCond);
  }
  if (filterOrg) conditions.push(eq(tickets.organizationId, filterOrg));
  if (filterCustomer) conditions.push(eq(tickets.customerEmail, filterCustomer));

  const where = conditions.length === 1 ? conditions[0] : and(...conditions);

  const activeFilterCount =
    (filterStream ? 1 : 0) +
    (filterStatus ? 1 : 0) +
    (filterPriority ? 1 : 0) +
    (filterCategory ? 1 : 0) +
    (filterAssignee ? 1 : 0) +
    (filterEscalated ? 1 : 0) +
    (filterFrom || filterTo ? 1 : 0) +
    (filterBilling ? 1 : 0) +
    (filterOrg ? 1 : 0) +
    (filterCustomer ? 1 : 0);

  // Page slice + total count in parallel. The count powers the numbered pager
  // and "N of T" range; the WHERE only references `tickets` columns (plus
  // self-contained EXISTS subqueries), so the count query needs no joins.
  const [rawRows, [totalRow]] = await Promise.all([
    db
      .select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        subject: tickets.subject,
        category: tickets.category,
        status: tickets.status,
        priority: tickets.priority,
        isEscalated: tickets.isEscalated,
        billable: tickets.billable,
        invoiceNumber: tickets.invoiceNumber,
        customerName: tickets.customerName,
        customerEmail: tickets.customerEmail,
        // Registered org (verified via FK) + the raw company the submitter
        // typed (an unverified claim we fall back to when nothing matched).
        organizationName: organizations.name,
        customerCompany: tickets.customerCompany,
        assignedToId: tickets.assignedToId,
        assignedToName: users.name,
        createdAt: tickets.createdAt,
        updatedAt: tickets.updatedAt,
      })
      .from(tickets)
      .leftJoin(users, eq(users.id, tickets.assignedToId))
      .leftJoin(organizations, eq(organizations.id, tickets.organizationId))
      .where(where)
      .orderBy(desc(tickets.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(tickets).where(where),
  ]);
  const { items: rows } = takePage(rawRows, pageSize);
  const totalItems = totalRow?.value ?? 0;

  // Options for the Organization + Customer filter dropdowns. The customer list
  // is the distinct set of customers across tickets the viewer can see, built
  // automatically (name + email, one entry per email).
  const [orgOptions, customerRows] = await Promise.all([
    db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .orderBy(organizations.name),
    db
      .select({
        email: tickets.customerEmail,
        name: sql<string | null>`max(${tickets.customerName})`,
      })
      .from(tickets)
      .where(
        and(
          ticketsVisibilityCondition(user),
          sql`${tickets.customerEmail} is not null and ${tickets.customerEmail} <> ''`,
        ),
      )
      .groupBy(tickets.customerEmail)
      .orderBy(
        sql`lower(coalesce(max(${tickets.customerName}), ${tickets.customerEmail}))`,
      ),
  ]);
  const customerOptions = customerRows.map((c) => ({
    email: c.email ?? "",
    name: c.name ?? c.email ?? "",
  }));

  const countLine = search
    ? t("countMatching", { count: totalItems, query: search })
    : t("count", { count: totalItems });

  // Tab links preserve every active filter/search but reset paging. "active"
  // is the canonical default, so it carries no `view` param.
  const viewTabParams = new URLSearchParams(
    Object.entries(sp).filter(
      ([k, v]) =>
        typeof v === "string" && v.length > 0 && k !== "view" && k !== "page",
    ) as [string, string][],
  );
  const viewHref = (v: "active" | "closed" | "all") => {
    const p = new URLSearchParams(viewTabParams);
    if (v === "active") p.delete("view");
    else p.set("view", v);
    const qs = p.toString();
    return qs ? `/admin/tickets?${qs}` : "/admin/tickets";
  };
  const viewTabs = [
    { key: "active" as const, label: t("viewActive") },
    { key: "closed" as const, label: t("viewClosed") },
    { key: "all" as const, label: t("viewAll") },
  ];

  // Carry the active list filters onto the export so it matches what's shown.
  const exportParams: Record<string, string> = {};
  for (const k of [
    "q",
    "view",
    "status",
    "priority",
    "category",
    "stream",
    "assignee",
    "escalated",
    "from",
    "to",
    "billing",
    "org",
    "customer",
  ] as const) {
    const v = sp[k];
    if (typeof v === "string" && v.length > 0) exportParams[k] = v;
  }

  return (
    <div className="space-y-4">
      {sp.reassigned ? <ReassignedNotice name={sp.reassigned} /> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">{t("title")}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {countLine}
            {activeFilterCount > 0
              ? ` · ${tFilters("active", { count: activeFilterCount })}`
              : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canExport ? (
            <ExportMenu baseHref="/api/tickets/export" params={exportParams} />
          ) : null}
          {canCreate ? (
            <Button
              nativeButton={false}
              render={<Link href="/admin/tickets/new" />}
            >
              {t("createOnBehalf")}
            </Button>
          ) : null}
        </div>
      </div>

      <div
        role="tablist"
        aria-label={t("viewTabsLabel")}
        className="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-800 dark:bg-zinc-900"
      >
        {viewTabs.map((tab) => {
          const active = view === tab.key;
          return (
            <Link
              key={tab.key}
              href={viewHref(tab.key)}
              role="tab"
              aria-selected={active}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                active
                  ? "bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <UrlSearchInput
        initialValue={search}
        placeholder={t("search")}
        className="max-w-md"
      />

      <TicketFilters
        initial={{
          status: filterStatus ?? [],
          priority: filterPriority ?? [],
          category: filterCategory ?? [],
          stream: filterStream ?? [],
          assignee: filterAssignee ?? "",
          escalated: filterEscalated,
          from: filterFrom ?? "",
          to: filterTo ?? "",
          billing: filterBilling ?? [],
          org: filterOrg ?? "",
          customer: filterCustomer ?? "",
          q: search,
          view,
        }}
        technicians={technicians}
        organizations={orgOptions}
        customers={customerOptions}
        activeCount={activeFilterCount}
      />

      <Card className="p-0">
        <CardContent
          className="p-0"
          style={{ minHeight: reservedTableHeight(pageSize, totalItems, 57) }}
        >
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
                  <TableHead>{t("columns.category")}</TableHead>
                  <TableHead>{t("columns.priority")}</TableHead>
                  <TableHead>{t("columns.status")}</TableHead>
                  <TableHead>{t("columns.billing")}</TableHead>
                  <TableHead>{t("columns.customer")}</TableHead>
                  <TableHead>{t("columns.organization")}</TableHead>
                  <TableHead>{t("columns.assignee")}</TableHead>
                  <TableHead>{t("columns.created")}</TableHead>
                  <TableHead>{t("columns.updated")}</TableHead>
                  <StickyActionsHead>{tCommon("actions")}</StickyActionsHead>
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
                      <CategoryBadge category={row.category} />
                    </TableCell>
                    <TableCell>
                      <PriorityBadge priority={row.priority} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>
                      <BillingBadge
                        billable={row.billable}
                        invoiceNumber={row.invoiceNumber}
                      />
                    </TableCell>
                    <TableCell className="text-sm">
                      <div>{row.customerName}</div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {row.customerEmail}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {/* Verified org (FK match) wins; otherwise the typed
                          company shown muted + tagged unverified; else —. */}
                      {row.organizationName ? (
                        row.organizationName
                      ) : row.customerCompany ? (
                        <span className="text-zinc-500 dark:text-zinc-400">
                          {row.customerCompany}
                          <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] uppercase tracking-wide text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                            {t("orgUnverified")}
                          </span>
                        </span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.assignedToName ?? (
                        <span className="text-zinc-400">
                          {t("unassigned")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-zinc-500 dark:text-zinc-400">
                      {formatter.dateTime(row.createdAt, { dateStyle: "medium" })}
                    </TableCell>
                    <TableCell className="text-xs text-zinc-500 dark:text-zinc-400">
                      {formatRelative(row.updatedAt, t, formatter)}
                    </TableCell>
                    <StickyActionsCell>
                      <TicketRowActions
                        ticket={row}
                        technicians={technicians}
                        canAssign={canAssignGlobal}
                        canEdit={canAssignGlobal}
                        canDelete={canDeleteGlobal}
                      />
                    </StickyActionsCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Pagination
        pathname="/admin/tickets"
        page={page}
        pageSize={pageSize}
        totalItems={totalItems}
        searchParams={new URLSearchParams(
          Object.entries(sp).filter(
            ([, v]) => typeof v === "string" && v.length > 0,
          ) as [string, string][],
        )}
      />
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
