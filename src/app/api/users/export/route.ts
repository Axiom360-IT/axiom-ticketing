import { and, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { organizations } from "@/lib/db/schema/organizations";
import { type ExportDataset, parseExportFormat } from "@/lib/export/dataset";
import { exportResponse } from "@/lib/export/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EXPORT_CAP = 10000;

// Mirrors /admin/users' "internal" audience partition (anyone holding one of
// these roles is internal staff; everyone else is external). Kept in sync with
// INTERNAL_ROLE_NAMES in src/app/actions/users.ts.
const INTERNAL_ROLE_NAMES = [
  "Super Admin",
  "IT Director",
  "Coordinator",
  "Technician",
];

function fmt(d: Date | null): string {
  return d ? d.toISOString().slice(0, 16).replace("T", " ") : "—";
}

export async function GET(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthenticated", { status: 401 });
  if (!(await can(user, "users.view", { type: "global" }, productionContext))) {
    return new Response("Forbidden", { status: 403 });
  }

  // Mirrors the /admin/users filter contract, plus an optional `orgId` scope so
  // an organization's full user list can be exported (e.g. on request).
  const sp = new URL(request.url).searchParams;
  const format = parseExportFormat(sp.get("format"));
  const search = sp.get("q")?.trim() ?? "";
  const roleId = sp.get("roleId")?.trim() || undefined;
  const orgId = sp.get("orgId")?.trim() || undefined;
  const status =
    sp.get("status") === "inactive"
      ? "inactive"
      : sp.get("status") === "all"
        ? "all"
        : "active";
  // Audience mirrors the /admin/users tab when given. With no explicit tab, an
  // org-scoped export includes ALL of that org's users (they're usually
  // external customers, so defaulting to "internal" would wrongly drop them);
  // otherwise default to "internal" like the users page.
  const tabParam = sp.get("tab");
  const audience =
    tabParam === "external"
      ? "external"
      : tabParam === "internal"
        ? "internal"
        : tabParam === "all"
          ? "all"
          : orgId
            ? "all"
            : "internal";

  // Correlated to the OUTER users row — qualify with the real table name so the
  // reference can't bind to the subquery's own tables.
  const rolesText = sql<
    string | null
  >`(select string_agg(r.name, ', ' order by r.name) from user_roles r_ur join roles r on r.id = r_ur.role_id where r_ur.user_id = "users"."id")`;
  const internalIn = sql.join(
    INTERNAL_ROLE_NAMES.map((n) => sql`${n}`),
    sql`, `,
  );

  const conditions: SQL[] = [];
  if (search) {
    const orClause = or(
      ilike(users.name, `%${search}%`),
      ilike(users.email, `%${search}%`),
    );
    if (orClause) conditions.push(orClause);
  }
  if (status === "active") conditions.push(eq(users.isActive, true));
  else if (status === "inactive") conditions.push(eq(users.isActive, false));
  if (orgId) conditions.push(eq(users.organizationId, orgId));
  if (roleId) {
    conditions.push(
      sql`exists (select 1 from user_roles ur where ur.user_id = "users"."id" and ur.role_id = ${roleId})`,
    );
  }
  if (audience === "internal") {
    conditions.push(
      sql`exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = "users"."id" and r.name in (${internalIn}))`,
    );
  } else if (audience === "external") {
    conditions.push(
      sql`not exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = "users"."id" and r.name in (${internalIn}))`,
    );
  }

  const where =
    conditions.length === 0
      ? undefined
      : conditions.length === 1
        ? conditions[0]
        : and(...conditions);

  const rows = await db
    .select({
      name: users.name,
      email: users.email,
      rolesText,
      organizationName: organizations.name,
      isActive: users.isActive,
      phone: users.phone,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(organizations, eq(organizations.id, users.organizationId))
    .where(where)
    .orderBy(users.name)
    .limit(EXPORT_CAP + 1);

  const capped = rows.length > EXPORT_CAP;
  const items = capped ? rows.slice(0, EXPORT_CAP) : rows;

  const scope = orgId
    ? `Organization: ${items[0]?.organizationName ?? orgId}`
    : audience === "internal"
      ? "Staff (internal)"
      : audience === "external"
        ? "Customers (external)"
        : "All users";

  const dataset: ExportDataset = {
    title: "Users export",
    subtitle: `${items.length} user${items.length === 1 ? "" : "s"}`,
    orientation: "landscape",
    meta: [
      { label: "Scope", value: scope },
      { label: "Generated at", value: `${fmt(new Date())} UTC` },
    ],
    sections: [
      {
        kind: "table",
        title: "Users",
        note: capped
          ? `Capped at ${EXPORT_CAP} rows — narrow the filters to export the rest.`
          : undefined,
        columns: [
          "Name",
          "Email",
          "Roles",
          "Organization",
          "Status",
          "Phone",
          "Last sign-in",
          "Created",
        ],
        rows: items.map((r) => [
          r.name,
          r.email,
          r.rolesText ?? "No roles",
          r.organizationName ?? "—",
          r.isActive ? "Active" : "Inactive",
          r.phone ?? "—",
          fmt(r.lastLoginAt),
          fmt(r.createdAt),
        ]),
      },
    ],
  };

  return exportResponse(dataset, format, orgId ? "users-organization" : "users");
}
