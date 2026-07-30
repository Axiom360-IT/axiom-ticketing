import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  ne,
  or,
  type SQL,
} from "drizzle-orm";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { ticketsVisibilityCondition } from "@/lib/auth/scope";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { organizations } from "@/lib/db/schema/organizations";
import { tickets } from "@/lib/db/schema/tickets";
import { type ExportDataset, parseExportFormat } from "@/lib/export/dataset";
import { exportResponse } from "@/lib/export/respond";
import { BILLING_FILTER_VALUES } from "@/lib/tickets/billing-status";
import { loadAllTicketCategories } from "@/lib/tickets/categories";
import { loadAllTicketTypes } from "@/lib/tickets/types";
import { billingFilterCondition } from "@/lib/tickets/ticket-filter-conditions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Rows beyond this are dropped with a note — an unbounded export could pull the
// entire ticket table into one document.
const EXPORT_CAP = 5000;

const STATUSES = [
  "open",
  "in_progress",
  "awaiting_customer_confirmation",
  "on_hold",
  "resolved",
  "closed",
] as const;
const PRIORITIES = ["low", "medium", "high", "critical"] as const;
const STREAMS = ["internal", "external"] as const;

// Friendly labels for the raw billable category (no code-y underscores in the
// exported file).
const BILLABLE_LABEL: Record<string, string> = {
  yes: "Billable",
  no: "Non-billable",
  monthly_plan: "Monthly plan",
  project: "Project",
  rework: "Rework",
};

function enumCsv<T extends string>(
  raw: string | null,
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

function fmt(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace("T", " ")}`;
}

export async function GET(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthenticated", { status: 401 });
  if (
    !(await can(user, "tickets.export", { type: "global" }, productionContext))
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  // Mirrors the /admin/tickets filter contract so the export matches the list.
  const sp = new URL(request.url).searchParams;
  const format = parseExportFormat(sp.get("format"));
  const search = sp.get("q")?.trim() ?? "";
  const view: "active" | "closed" | "all" =
    sp.get("view") === "closed"
      ? "closed"
      : sp.get("view") === "all"
        ? "all"
        : "active";
  // Categories are admin-managed; allow filtering by any known value (incl.
  // retired ones) and resolve labels for the export cells.
  const [allCategories, allTypes] = await Promise.all([
    loadAllTicketCategories(),
    loadAllTicketTypes(),
  ]);
  const categoryValues = allCategories.map((c) => c.value);
  const categoryLabelMap = new Map(allCategories.map((c) => [c.value, c.label]));
  const typeValues = allTypes.map((t) => t.value);
  const typeLabelMap = new Map(allTypes.map((t) => [t.value, t.label]));

  const fStatus = enumCsv(sp.get("status"), STATUSES);
  const fPriority = enumCsv(sp.get("priority"), PRIORITIES);
  const fCategory = enumCsv(sp.get("category"), categoryValues);
  const fType = enumCsv(sp.get("type"), typeValues);
  const fStream = enumCsv(sp.get("stream"), STREAMS);
  const fAssignee = sp.get("assignee")?.trim() || undefined;
  const fEscalated = sp.get("escalated") === "1";
  const fFrom = sp.get("from")?.trim() || undefined;
  const fTo = sp.get("to")?.trim() || undefined;
  const fBilling = enumCsv(sp.get("billing"), BILLING_FILTER_VALUES);
  const fOrg = sp.get("org")?.trim() || undefined;
  const fCustomer = sp.get("customer")?.trim() || undefined;

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
  if (view === "closed") conditions.push(eq(tickets.status, "closed"));
  else if (view === "active") conditions.push(ne(tickets.status, "closed"));
  if (fStatus) {
    const scoped =
      view === "closed"
        ? fStatus.filter((s) => s === "closed")
        : view === "active"
          ? fStatus.filter((s) => s !== "closed")
          : fStatus;
    if (scoped.length > 0) conditions.push(inArray(tickets.status, scoped));
  }
  if (fPriority) conditions.push(inArray(tickets.priority, fPriority));
  if (fCategory) conditions.push(inArray(tickets.category, fCategory));
  if (fType) conditions.push(inArray(tickets.type, fType));
  if (fStream) conditions.push(inArray(tickets.stream, fStream));
  if (fAssignee === "unassigned") conditions.push(isNull(tickets.assignedToId));
  else if (fAssignee) conditions.push(eq(tickets.assignedToId, fAssignee));
  if (fEscalated) conditions.push(eq(tickets.isEscalated, true));
  if (fFrom) {
    const d = new Date(`${fFrom}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) conditions.push(gte(tickets.createdAt, d));
  }
  if (fTo) {
    const d = new Date(`${fTo}T23:59:59.999Z`);
    if (!Number.isNaN(d.getTime())) conditions.push(lte(tickets.createdAt, d));
  }
  if (fBilling) {
    const billingCond = billingFilterCondition(fBilling);
    if (billingCond) conditions.push(billingCond);
  }
  if (fOrg) conditions.push(eq(tickets.organizationId, fOrg));
  if (fCustomer) conditions.push(eq(tickets.customerEmail, fCustomer));

  const where = conditions.length === 1 ? conditions[0] : and(...conditions);

  const rows = await db
    .select({
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      status: tickets.status,
      priority: tickets.priority,
      category: tickets.category,
      type: tickets.type,
      stream: tickets.stream,
      isEscalated: tickets.isEscalated,
      billable: tickets.billable,
      invoiceNumber: tickets.invoiceNumber,
      organizationName: organizations.name,
      customerCompany: tickets.customerCompany,
      customerName: tickets.customerName,
      customerEmail: tickets.customerEmail,
      assignedToName: users.name,
      createdAt: tickets.createdAt,
      updatedAt: tickets.updatedAt,
    })
    .from(tickets)
    .leftJoin(users, eq(users.id, tickets.assignedToId))
    .leftJoin(organizations, eq(organizations.id, tickets.organizationId))
    .where(where)
    .orderBy(desc(tickets.createdAt))
    .limit(EXPORT_CAP + 1);

  const capped = rows.length > EXPORT_CAP;
  const items = capped ? rows.slice(0, EXPORT_CAP) : rows;

  const dataset: ExportDataset = {
    title: "Tickets export",
    subtitle: `${items.length} ticket${items.length === 1 ? "" : "s"}`,
    orientation: "landscape",
    meta: [
      { label: "View", value: view },
      { label: "Generated at", value: `${fmt(new Date())} UTC` },
    ],
    sections: [
      {
        kind: "table",
        title: "Tickets",
        note: capped
          ? `Capped at ${EXPORT_CAP} rows — narrow the filters to export the rest.`
          : undefined,
        columns: [
          "Ticket",
          "Subject",
          "Status",
          "Priority",
          "Type",
          "Category",
          "Stream",
          "Billable",
          "Invoice #",
          "Organization",
          "Customer",
          "Email",
          "Assignee",
          "Created",
          "Updated",
        ],
        rows: items.map((r) => [
          r.ticketNumber,
          r.isEscalated ? `${r.subject} (escalated)` : r.subject,
          r.status,
          r.priority,
          typeLabelMap.get(r.type) ?? r.type,
          categoryLabelMap.get(r.category) ?? r.category,
          r.stream,
          r.billable ? (BILLABLE_LABEL[r.billable] ?? r.billable) : "",
          r.invoiceNumber ?? "",
          r.organizationName ?? r.customerCompany ?? "—",
          r.customerName,
          r.customerEmail,
          r.assignedToName ?? "Unassigned",
          fmt(r.createdAt),
          fmt(r.updatedAt),
        ]),
      },
    ],
  };

  return exportResponse(dataset, format, "tickets");
}
