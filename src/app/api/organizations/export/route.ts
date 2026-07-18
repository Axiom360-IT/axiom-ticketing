import { and, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema/organizations";
import { type ExportDataset, parseExportFormat } from "@/lib/export/dataset";
import { exportResponse } from "@/lib/export/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EXPORT_CAP = 10000;

// Hours are stored as integer minutes; the UI shows them in hours.
function fmtHours(minutes: number | null): string {
  if (minutes === null || minutes === undefined) return "—";
  const h = minutes / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(2);
}
function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

export async function GET(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthenticated", { status: 401 });
  if (
    !(await can(
      user,
      "organizations.view",
      { type: "global" },
      productionContext,
    ))
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  // Mirrors the /admin/organizations filter contract.
  const sp = new URL(request.url).searchParams;
  const format = parseExportFormat(sp.get("format"));
  const search = sp.get("q")?.trim() ?? "";
  const plan =
    sp.get("plan") === "monthly"
      ? "monthly"
      : sp.get("plan") === "one_off"
        ? "one_off"
        : "";
  const status =
    sp.get("status") === "active"
      ? "active"
      : sp.get("status") === "inactive"
        ? "inactive"
        : "";

  const conditions: SQL[] = [];
  if (search) {
    const orClause = or(
      ilike(organizations.name, `%${search}%`),
      ilike(organizations.abbreviation, `%${search}%`),
    );
    if (orClause) conditions.push(orClause);
  }
  if (plan === "monthly") conditions.push(eq(organizations.isMonthlyPlan, true));
  else if (plan === "one_off")
    conditions.push(eq(organizations.isMonthlyPlan, false));
  if (status === "active") conditions.push(eq(organizations.isActive, true));
  else if (status === "inactive")
    conditions.push(eq(organizations.isActive, false));

  const where =
    conditions.length === 0
      ? undefined
      : conditions.length === 1
        ? conditions[0]
        : and(...conditions);

  // Correlated to the OUTER organizations row (qualified table name).
  const domainsText = sql<
    string | null
  >`(select string_agg(d.domain, ', ' order by d.domain) from organization_domains d where d.organization_id = "organizations"."id")`;
  const userCount = sql<number>`(select count(*) from users u where u.organization_id = "organizations"."id")`;

  const rows = await db
    .select({
      name: organizations.name,
      abbreviation: organizations.abbreviation,
      isMonthlyPlan: organizations.isMonthlyPlan,
      included: organizations.monthlyMinutesIncluded,
      balance: organizations.monthlyMinutesBalance,
      isActive: organizations.isActive,
      createdAt: organizations.createdAt,
      domainsText,
      userCount,
    })
    .from(organizations)
    .where(where)
    .orderBy(organizations.name)
    .limit(EXPORT_CAP + 1);

  const capped = rows.length > EXPORT_CAP;
  const items = capped ? rows.slice(0, EXPORT_CAP) : rows;

  const dataset: ExportDataset = {
    title: "Organizations export",
    subtitle: `${items.length} organization${items.length === 1 ? "" : "s"}`,
    orientation: "landscape",
    meta: [
      {
        label: "Generated at",
        value: `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
      },
    ],
    sections: [
      {
        kind: "table",
        title: "Organizations",
        note: capped ? `Capped at ${EXPORT_CAP} rows.` : undefined,
        columns: [
          "Name",
          "Code",
          "Plan",
          "Included hrs",
          "Balance hrs",
          "Email domains",
          "Users",
          "Status",
          "Created",
        ],
        align: [
          "left",
          "left",
          "left",
          "right",
          "right",
          "left",
          "right",
          "left",
          "left",
        ],
        rows: items.map((r) => [
          r.name,
          r.abbreviation,
          r.isMonthlyPlan ? "Monthly plan" : "One-off",
          r.isMonthlyPlan ? fmtHours(r.included) : "—",
          r.isMonthlyPlan ? fmtHours(r.balance) : "—",
          r.domainsText ?? "—",
          Number(r.userCount ?? 0),
          r.isActive ? "Active" : "Inactive",
          fmtDate(r.createdAt),
        ]),
      },
    ],
  };

  return exportResponse(dataset, format, "organizations");
}
